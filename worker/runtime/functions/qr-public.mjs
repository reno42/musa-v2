// Códigos QR de Musa v2 — lo público, sin cuenta.
//   GET /r/:code  → redirige al destino del QR dinámico y cuenta el escaneo (día, país, tipo de equipo; sin IP).
//                   Pausado o borrado: una página que lo explica (no un JSON ni un 404 pelado como en QeepeR).
//   GET /v/:id    → «ver y descargar» un diseño o presentación compartido (templates.is_public): lo dibuja igual
//                   que el editor (CSS encerrado por frame, HTML limpio con DOMPurify) y deja bajar PNG / PDF y
//                   presentar. Es a donde apunta el QR de un diseño: /c/:id es la página de comentarios y pide cuenta.
import { getSupabaseAdmin } from "../../../api/src/services/supabase.js";
import { recordQrCapture } from "./qr-capture.mjs";
import { framePlayback, STATIC_CSS } from "../../../api/src/services/designStatic.ts";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isEs = (req) => /^es\b/i.test(String(req.headers.get("accept-language") || "es").trim());
const BOT_RE = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|slack|twitter|linkedin|embedly|skype|curl|wget|python|httpclient|axios|node-fetch|go-http|headless|lighthouse|monitor|uptime/i;

function device(ua) {
  if (/ipad|tablet|kindle|silk|playbook|(android(?!.*mobile))/i.test(ua)) return "tablet";
  if (/mobi|iphone|ipod|android|phone/i.test(ua)) return "mobile";
  return "desktop";
}
function safeDest(u) {
  try { const p = new URL(u); return p.protocol === "http:" || p.protocol === "https:" ? p.href : null; } catch { return null; }
}

function page(req, status, title, text, extra = "") {
  const es = isEs(req);
  const body = `<!doctype html><html lang="${es ? "es" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f3f1e7;color:#111;font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:24px}
main{max-width:440px;text-align:center}.q{width:64px;height:64px;margin:0 auto 18px;border-radius:16px;background:#111;display:grid;place-items:center}
h1{font-size:24px;line-height:1.2;margin:0 0 10px}p{margin:0 0 8px;color:#555}small{display:block;margin-top:22px;color:#999;font-size:12px}small a{color:#999}</style></head>
<body><main><div class="q"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/></svg></div>
<h1>${esc(title)}</h1><p>${esc(text)}</p>${extra}<small>${es ? "Código QR creado con" : "QR code made with"} <a href="/">Musa</a></small></main></body></html>`;
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY" } });
}

/* ═════ /r/:code ═════ */
export async function handleQrRedirect(request, url) {
  const es = isEs(request);
  const code = decodeURIComponent(url.pathname.slice(3)).replace(/\/+$/, "");
  const missing = () => page(request, 404, es ? "Este código QR no existe" : "This QR code doesn't exist",
    es ? "Puede que lo hayan borrado o que el enlace esté incompleto." : "It may have been deleted, or the link is incomplete.");
  if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  if (!/^[A-Za-z0-9]{6,16}$/.test(code)) return missing();
  const sb = getSupabaseAdmin();
  if (!sb) return page(request, 503, es ? "No pudimos abrir el enlace" : "We couldn't open the link", es ? "Intenta de nuevo en un momento." : "Please try again in a moment.");
  const ua = request.headers.get("user-agent") || "";
  const purpose = (request.headers.get("sec-purpose") || request.headers.get("purpose") || "").toLowerCase();
  /* vistas previas de enlaces (WhatsApp, Slack…), robots, HEAD y precargas no cuentan como escaneo */
  const count = request.method === "GET" && !BOT_RE.test(ua) && !purpose.includes("prefetch");
  const { data, error } = await sb.rpc("v2_qr_hit", { p_code: code, p_country: String(request.cf?.country || "").slice(0, 2), p_device: device(ua), p_count: count });
  if (error) {
    console.error("[qr] hit", error.message);
    return page(request, 503, es ? "No pudimos abrir el enlace" : "We couldn't open the link", es ? "Intenta de nuevo en un momento." : "Please try again in a moment.");
  }
  if (!data || data.state === "missing") return missing();
  if (data.state === "paused") {
    return page(request, 410, es ? "Este código QR está en pausa" : "This QR code is paused",
      es ? "Quien lo creó lo pausó por ahora. Vuelve a escanearlo más tarde." : "Its owner paused it for now. Try scanning it again later.");
  }
  let dest = safeDest(data.url);
  if (!dest) return missing();
  /* a un formulario, evento, website o diseño de Musa le pasa el código: si la persona deja sus datos, el CRM sabe
     por qué QR llegó (migración 41). A webs de afuera no se les agrega nada. */
  try {
    const u = new URL(dest);
    if (u.host === url.host && /^\/(f|e|w|v)\//.test(u.pathname) && !u.searchParams.has("qr")) { u.searchParams.set("qr", code); dest = u.href; }
  } catch { /* destino tal cual */ }
  /* 302 y sin caché: si cambias el destino, el próximo escaneo ya va al nuevo (y cada escaneo se cuenta) */
  return new Response(null, { status: 302, headers: { Location: dest, "Cache-Control": "no-store, max-age=0", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" } });
}

/* ═════ /v/:id — ver y descargar un diseño compartido ═════ */
const MAX_FRAMES = 30, MAX_BYTES = 2 * 1024 * 1024;

/* El QR de un diseño decide qué puede hacer quien lo escanea (qr_codes.fields.download, lo elige la persona al crearlo):
   free = ver y descargar · lead = deja nombre y correo para descargar (entra al CRM) · view = solo ver.
   El código del QR llega en ?qr=; sin él (enlace directo) vale el más estricto de los QR de ese diseño. */
const RANK = { view: 2, lead: 1, free: 0 };
const modeOf = (qr) => { const m = qr && qr.fields && qr.fields.download; return m === "lead" || m === "view" ? m : "free"; };
async function designQr(sb, tpl, code) {
  const { data } = await sb.from("qr_codes").select("id,name,code,workspace_id,created_by,brand_id,fields,target_type").eq("workspace_id", tpl.workspace_id).eq("target_id", tpl.id).in("target_type", ["design", "presentation"]);
  const rows = data || [];
  const hit = code && rows.find((r) => r.code === code);
  if (hit) return hit;
  return rows.sort((a, b) => RANK[modeOf(b)] - RANK[modeOf(a)])[0] || null;
}
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

/* POST /v/:id/lead — nombre y correo para descargar: la persona entra a Vender › Personas marcada con el QR */
async function designLead(request, sb, tpl, es) {
  let b; try { b = await request.json(); } catch { return json({ error: es ? "Datos inválidos" : "Invalid data" }, 400); }
  if (b && b.website) return json({ ok: true });   // honeypot: bots
  const name = String(b?.name || "").trim().slice(0, 120), email = String(b?.email || "").trim().toLowerCase().slice(0, 200), company = String(b?.company || "").trim().slice(0, 120) || null;
  if (!name) return json({ error: es ? "Escribe tu nombre" : "Enter your name" }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: es ? "Revisa tu correo" : "Check your email" }, 400);
  const qr = await designQr(sb, tpl, String(b?.qr || ""));
  if (!qr || modeOf(qr) !== "lead") return json({ ok: true, open: true });   // ya no pide datos: que descargue
  const meta = Array.isArray(tpl.meta) ? tpl.meta[0] : tpl.meta;
  const brandId = qr.brand_id || (meta && meta.brand_id) || null;
  let brand = null;
  if (brandId) { const { data } = await sb.from("brands").select("id,name").eq("id", brandId).maybeSingle(); brand = data || null; }
  const owner = qr.created_by || tpl.created_by || tpl.user_id || null;
  let contactId = null, isNew = false;
  if (owner) {
    const { data: ex } = await sb.from("crm_contacts").select("id").eq("workspace_id", tpl.workspace_id).ilike("email", email).maybeSingle();
    if (ex) contactId = ex.id;
    else {
      const [first, ...rest] = name.split(/\s+/);
      const { data: c, error } = await sb.from("crm_contacts").insert({ workspace_id: tpl.workspace_id, brand_id: brand ? brand.id : null, brand_name: brand ? brand.name : null, first_name: first, last_name: rest.join(" ") || null, email, company, status: "lead", tags: ["descarga"], created_by: owner, origin_source: "descarga", origin_post_ref: "design:" + tpl.id }).select("id").maybeSingle();
      if (error) console.error("[qr-view] lead:", error.message);
      contactId = (c && c.id) || null; isNew = !!contactId;
    }
  }
  await recordQrCapture(sb, qr, { contactId, isNew, kind: "descarga", name, email });
  return json({ ok: true });
}

export async function handleDesignView(request, url) {
  const es = isEs(request);
  const m = /^\/v\/([A-Za-z0-9_-]{3,80})(\/lead)?\/?$/.exec(url.pathname);
  const id = m ? m[1] : "", isLead = !!(m && m[2]);
  const gone = () => page(request, 404, es ? "Este diseño ya no está compartido" : "This design is no longer shared",
    es ? "Pídele a quien te lo compartió que lo vuelva a compartir." : "Ask whoever shared it to share it again.");
  if (isLead ? request.method !== "POST" : (request.method !== "GET" && request.method !== "HEAD")) return new Response(null, { status: 405, headers: { Allow: isLead ? "POST" : "GET, HEAD" } });
  if (!m) return gone();
  const sb = getSupabaseAdmin();
  if (!sb) return page(request, 503, es ? "No pudimos abrir el diseño" : "We couldn't open the design", es ? "Intenta de nuevo en un momento." : "Please try again in a moment.");
  const { data: tpl } = await sb.from("templates").select("id,name,is_public,deleted_at,data,workspace_id,created_by,user_id,meta:design_file_meta(brand_id)").eq("id", id).maybeSingle();
  if (!tpl || tpl.deleted_at || tpl.is_public !== true) return isLead ? json({ error: es ? "Este diseño ya no está compartido" : "This design is no longer shared" }, 404) : gone();
  if (isLead) return designLead(request, sb, tpl, es);
  let d = tpl.data || {};
  if (typeof d === "string") { try { d = JSON.parse(d); } catch { d = {}; } }
  const raw = Array.isArray(d.frames) && d.frames.length ? d.frames : [{ name: tpl.name, html: d.html || "", css: d.css || "", width: d.width, height: d.height, background: d.background }];
  const frames = []; let bytes = 0;
  for (const f of raw.slice(0, MAX_FRAMES)) {
    /* quieto = la portada; al presentar, la lámina se reproduce con su animación (pb) */
    const pb = f?.animation ? framePlayback(f.animation) : null;
    const html = typeof f?.html === "string" ? f.html : "", css = (typeof f?.css === "string" ? f.css : "") + (pb || /data-layer-kind="(?:video|live)"/.test(html) ? STATIC_CSS : "");
    if (bytes + html.length + css.length > MAX_BYTES) break;
    bytes += html.length + css.length;
    frames.push({ name: String(f?.name || `Frame ${frames.length + 1}`).slice(0, 120), w: Math.max(1, Math.min(8000, Number(f?.width) || Number(d.width) || 1080)), h: Math.max(1, Math.min(8000, Number(f?.height) || Number(d.height) || 1080)), bg: typeof f?.background === "string" ? f.background : (typeof f?.fill === "string" ? f.fill : "#ffffff"), html, css, pb });
  }
  if (!frames.length) return gone();
  const present = url.searchParams.get("present") === "1";
  const qr = await designQr(sb, tpl, url.searchParams.get("qr"));
  const mode = modeOf(qr);
  let brandName = null;
  if (mode === "lead") {
    const meta = Array.isArray(tpl.meta) ? tpl.meta[0] : tpl.meta;
    const bid = (qr && qr.brand_id) || (meta && meta.brand_id);
    if (bid) { const { data } = await sb.from("brands").select("name").eq("id", bid).maybeSingle(); brandName = (data && data.name) || null; }
  }
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const T = es
    ? { pdf: "Descargar PDF", png: "Descargar PNG", pres: "Presentar", all: "Descargar todo en PDF", busy: "Preparando…", done: "Listo", fail: "No se pudo descargar: ", of: "de", made: "Compartido con", n1: "lámina", nn: "láminas", close: "Cerrar", trunc: "Se muestran las primeras láminas del archivo.",
        view: "Para ver: este diseño no se descarga.", lTitle: "Para descargarlo, deja tus datos", lSub: brandName ? "Tu nombre y correo los recibe " + brandName + "." : "Tu nombre y correo los recibe quien te lo compartió.", lName: "Nombre", lEmail: "Correo", lCompany: "Empresa (opcional)", lGo: "Descargar", lCancel: "Cancelar" }
    : { pdf: "Download PDF", png: "Download PNG", pres: "Present", all: "Download all as PDF", busy: "Preparing…", done: "Done", fail: "Couldn't download: ", of: "of", made: "Shared with", n1: "slide", nn: "slides", close: "Close", trunc: "Showing the first slides of the file.",
        view: "View only: this design can't be downloaded.", lTitle: "Leave your details to download it", lSub: brandName ? "Your name and email go to " + brandName + "." : "Your name and email go to whoever shared it with you.", lName: "Name", lEmail: "Email", lCompany: "Company (optional)", lGo: "Download", lCancel: "Cancel" };
  /* «<» escapado para que ningún texto cierre el <script> donde va el JSON (JSON.parse lo devuelve igual) */
  const BS = String.fromCharCode(92);
  const payload = JSON.stringify({ name: tpl.name || "Diseño", frames, present, truncated: frames.length < raw.length, mode, qr: (qr && qr.code) || "", T }).split("<").join(BS + "u003c");
  const csp = [
    "default-src 'none'", `script-src 'self' 'nonce-${nonce}'`, "style-src 'self' 'unsafe-inline' https:", "font-src https: data:",
    "img-src https: data: blob:", "media-src https: data: blob:", "connect-src 'self' https: data: blob:", "frame-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
  ].join("; ");
  const html = `<!doctype html><html lang="${es ? "es" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(tpl.name || "Diseño")}</title>
<style>*{box-sizing:border-box}html,body{margin:0}body{background:#ecebe4;color:#111;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.top{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 16px;background:rgba(236,235,228,.94);backdrop-filter:blur(8px);border-bottom:1px solid #d9d7cc}
.top h1{font-size:16px;margin:0;flex:1 1 200px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.top h1 small{display:block;font-weight:500;color:#777;font-size:12px}
.b{appearance:none;border:0;border-radius:50px;padding:9px 16px;font:700 13px system-ui,sans-serif;cursor:pointer;background:#fff;color:#111;box-shadow:0 1px 3px rgba(0,0,0,.08)}.b.pri{background:#ff5e00;color:#fff}.b:disabled{opacity:.55;cursor:default}
.list{max-width:980px;margin:0 auto;padding:18px 16px 60px;display:flex;flex-direction:column;gap:22px}.fr{background:#fff;border-radius:14px;box-shadow:0 2px 14px rgba(0,0,0,.07);overflow:hidden}
.fr .stage{position:relative;overflow:hidden;margin:0 auto}.fr .bar{display:flex;align-items:center;gap:8px;padding:10px 12px;border-top:1px solid #eee;font-size:13px;color:#666}.fr .bar span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.note{max-width:980px;margin:0 auto;padding:0 16px;color:#777;font-size:13px}.foot{text-align:center;color:#999;font-size:12px;padding:0 0 30px}.foot a{color:#999}
.pv{position:fixed;inset:0;z-index:20;background:#000;display:none;align-items:center;justify-content:center}.pv.on{display:flex}.pv .x{position:absolute;top:12px;right:12px}.pv .n{position:absolute;bottom:14px;left:0;right:0;text-align:center;color:#aaa;font-size:13px}
.toast{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);background:#111;color:#fff;padding:10px 16px;border-radius:50px;font-size:13px;opacity:0;transition:opacity .2s;pointer-events:none;z-index:30}.toast.on{opacity:1}
.ld{position:fixed;inset:0;z-index:25;background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center;padding:16px}.ld.on{display:flex}
.ld form{background:#fff;border-radius:16px;padding:22px;max-width:380px;width:100%;display:flex;flex-direction:column;gap:10px}.ld h2{margin:0;font-size:19px}.ld p{margin:0 0 4px;color:#666;font-size:13px}
.ld label{display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:600}.ld input{border:1.5px solid #d6d4c6;border-radius:10px;padding:10px 12px;font:inherit;font-weight:400}.ld .hp{position:absolute;left:-9999px}
.ld .er{color:#c22;font-size:13px;min-height:1em;margin:0}.ld .row{display:flex;gap:8px;justify-content:flex-end}.vo{color:#777;font-size:13px}</style>
</head><body>
<div class="top"><h1 id="ttl"></h1><button class="b" id="bPres" hidden></button><button class="b pri" id="bPdf"></button></div>
<p class="note" id="trunc" hidden></p><div class="list" id="list"></div>
<div class="foot">${es ? "Compartido con" : "Shared with"} <a href="/">Musa</a></div>
<div class="pv" id="pv"><button class="b x" id="pvX"></button><div id="pvStage"></div><div class="n" id="pvN"></div></div><div class="toast" id="toast"></div>
<div class="ld" id="ld"><form id="ldF" novalidate><h2 id="ldT"></h2><p id="ldS"></p><label><span id="ldN"></span><input name="name" autocomplete="name" maxlength="120" required></label><label><span id="ldE"></span><input name="email" type="email" autocomplete="email" maxlength="200" required></label><label><span id="ldC"></span><input name="company" autocomplete="organization" maxlength="120"></label><input name="website" class="hp" tabindex="-1" autocomplete="off"><p class="er" id="ldEr"></p><div class="row"><button type="button" class="b" id="ldX"></button><button class="b pri" id="ldGo"></button></div></form></div>
<script type="application/json" id="musa-design">${payload}</script>
<script nonce="${nonce}" src="/musa/vendor/purify.min.js"></script>
<script nonce="${nonce}">${VIEWER_JS}</script>
</body></html>`;
  return new Response(request.method === "HEAD" ? null : html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": csp, "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
}

/* El visor: el mismo encierre de CSS y la misma limpieza del HTML que el editor (bridge-editor.js), y la misma
   exportación (html2canvas sobre el frame a tamaño real fuera de la vista; jsPDF con una página por frame). */
const VIEWER_JS = String.raw`(function(){
"use strict";
var D=JSON.parse(document.getElementById("musa-design").textContent),T=D.T,$=function(s){return document.getElementById(s)};
var uid=0;
function SCOPE(id){var a='[data-tf="'+id+'"]';return a+a+a}
function scopeRules(list,sc){return [].map.call(list,function(r){if(r.type===1){return r.selectorText.split(",").map(function(s){s=s.trim();if(/^(:root|html|body)$/.test(s))return sc;return sc+" "+s.replace(/^(:root|html|body)\s+/,"")}).join(",")+"{"+r.style.cssText+"}"}if(r.type===4)return "@media "+r.conditionText+"{"+scopeRules(r.cssRules,sc)+"}";if(r.type===12)return "@supports "+r.conditionText+"{"+scopeRules(r.cssRules,sc)+"}";return r.cssText}).join("\n")}
function scopeCss(css,sc){var imports=[];css=String(css||"").replace(/@import\s+(?:url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\)|"[^"]*"|'[^']*')[^;]*;?/g,function(m){imports.push(/;\s*$/.test(m)?m:m+";");return ""});try{var sh=new CSSStyleSheet();sh.replaceSync(css);return imports.join("\n")+"\n"+scopeRules(sh.cssRules,sc)}catch(e){return imports.join("\n")+"\n"+css}}
function cleanCss(css){return String(css||"").replace(/</g,"\\3c ").replace(/-->/g,"").replace(/expression\s*\(/gi,"x-expression(").replace(/(^|[;{\s])(-moz-binding|behavior)\s*:/gi,"$1x-blocked:").replace(/url\(\s*(['"]?)\s*(?:javascript|vbscript|data:text\/html)[^)]*\)/gi,"none").replace(/@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)|"([^"]*)"|'([^']*)')[^;]*;?/gi,function(m,a,b,c,d,e){var h=a||b||c||d||e||"";return /^https:\/\//i.test(h)?m:""})}
var PUR={FORCE_BODY:true,ADD_TAGS:["style"],ALLOW_DATA_ATTR:true,ALLOW_ARIA_ATTR:true,FORBID_TAGS:["script","noscript","iframe","frame","frameset","object","embed","applet","base","meta","link","title","template","portal","math","form"],FORBID_ATTR:["srcdoc","formaction","action","ping"],ADD_ATTR:["crossorigin","loading","decoding","target","draggable","playsinline","muted","autoplay","loop","poster","preload","controls","xmlns","xmlns:xlink","xlink:href","mask-type","paint-order","vector-effect"],ALLOWED_URI_REGEXP:/^(?:(?:https?|mailto|tel|blob):|#|\/|\.{0,2}\/|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,ADD_DATA_URI_TAGS:["image","feImage"]};
var hooked=false;
function cleanHtml(h){var P=window.DOMPurify;if(!P||!P.sanitize){var t=document.createElement("template");t.innerHTML=String(h||"");t.content.querySelectorAll("script,iframe,object,embed,link,meta,base,form").forEach(function(n){n.remove()});t.content.querySelectorAll("*").forEach(function(n){[].slice.call(n.attributes).forEach(function(a){if(/^on/i.test(a.name)||/javascript:/i.test(a.value))n.removeAttribute(a.name)})});return t.innerHTML}
if(!hooked){hooked=true;P.addHook("uponSanitizeAttribute",function(n,d){if(d.attrName==="style")d.attrValue=cleanCss(d.attrValue)});P.addHook("uponSanitizeElement",function(n,d){if(d.tagName==="style"&&n.textContent&&/<|expression|behavior|javascript:/i.test(n.textContent))n.textContent=cleanCss(n.textContent)})}
return P.sanitize(String(h||""),PUR)}
function root(f){var id="v"+(uid++),r=document.createElement("div");r.setAttribute("data-tf",id);r.style.cssText="position:absolute;inset:0;overflow:hidden;background:"+(f.bg||"#fff");r.innerHTML='<style>'+scopeCss(cleanCss(f.css),SCOPE(id))+"</style>"+cleanHtml(f.html);r.querySelectorAll("img").forEach(function(im){im.crossOrigin="anonymous";if(im.src)im.src=im.src});r.querySelectorAll("video").forEach(function(v){v.crossOrigin="anonymous";v.muted=true;v.playsInline=true;v.preload="auto"});if(f.pb)seekR(r,f,f.pb.poster);return r}
var PB={r:null,f:null,played:false,raf:0,t0:0,lives:[]};
function qid(id){return '[data-layer-id="'+String(id).replace(/"/g,"")+'"]'}
function anims(r,f){if(r.__a)return r.__a;r.__a=[];((f.pb&&f.pb.tweens)||[]).forEach(function(c){var el=r.querySelector(qid(c.id));if(!el||!el.animate)return;try{var a=el.animate(c.keyframes,{delay:c.delay,duration:c.duration,iterations:c.iterations<0?Infinity:c.iterations,direction:c.direction||"normal",fill:"both"});a.pause();r.__a.push(a)}catch(e){}});return r.__a}
function vidOf(v){try{return JSON.parse(decodeURIComponent(v.getAttribute("data-video")))}catch(e){return null}}
function mtime(V,t){return Math.max(0,(+V["in"]||0)+Math.max(0,t-(+V.start||0))*(+V.rate||1))}
function seekR(r,f,t){anims(r,f).forEach(function(a){try{a.pause();a.currentTime=t*1000}catch(e){}});r.querySelectorAll('video[data-layer-kind="video"][data-video]').forEach(function(v){var V=vidOf(v);if(!V)return;try{v.pause();v.currentTime=mtime(V,t)}catch(e){}})}
function staticR(r,f){(r.__a||[]).forEach(function(a){try{a.cancel()}catch(e){}});r.__a=[];var st=(f.pb&&f.pb.styles)||{};Object.keys(st).forEach(function(id){var el=r.querySelector(qid(id));if(!el)return;Object.keys(st[id]).forEach(function(p){try{el.style.setProperty(p,st[id][p],"important")}catch(e){}})})}
function vidImgs(r,f){var P0=f.pb?f.pb.poster:0;return Promise.all([].map.call(r.querySelectorAll('video[data-layer-kind="video"][data-video]'),function(v){return new Promise(function(ok){var V=vidOf(v);if(!V)return ok();var fin=false,done=function(){if(fin)return;fin=true;try{var c=document.createElement("canvas");c.width=v.videoWidth;c.height=v.videoHeight;c.getContext("2d").drawImage(v,0,0);var im=document.createElement("img");im.src=c.toDataURL("image/jpeg",0.92);im.setAttribute("style",v.getAttribute("style")||"");if(v.className)im.className=v.className;im.style.objectFit=getComputedStyle(v).objectFit||"cover";v.parentNode.replaceChild(im,v)}catch(e){}ok()};var go=function(){v.addEventListener("seeked",done,{once:true});try{v.currentTime=mtime(V,P0)}catch(e){done()}};if(v.readyState>=1)go();else v.addEventListener("loadedmetadata",go,{once:true});setTimeout(function(){if(!fin){fin=true;ok()}},8000)})}))}
function pvStop(){if(PB.r){(PB.r.__a||[]).forEach(function(a){try{a.pause()}catch(e){}});PB.r.querySelectorAll("video").forEach(function(v){clearTimeout(v.__t);try{v.pause()}catch(e){}})}cancelAnimationFrame(PB.raf);PB.lives.forEach(function(x){try{x.cli.destroy()}catch(e){}});PB.lives=[];PB.r=null;PB.f=null;PB.played=false}
function moving(r,f){return !!((f.pb&&f.pb.tweens&&f.pb.tweens.length)||r.querySelector('[data-layer-kind="live"][data-live],video[data-layer-kind="video"]'))}
function pvPlay(f,r){pvStop();if(!r)return;PB.f=f;PB.r=r;if(!moving(r,f))return;var mode=f.pb?f.pb.present.mode:"enter";if(mode==="enter")pvGo();else seekR(r,f,f.pb?f.pb.poster:0)}
function pvGo(){var r=PB.r,f=PB.f;if(!r)return;PB.played=true;PB.t0=performance.now();anims(r,f).forEach(function(a){try{a.currentTime=0;a.play()}catch(e){}});r.querySelectorAll('video[data-layer-kind="video"][data-video]').forEach(function(v){var V=vidOf(v);if(!V)return;v.muted=true;try{v.pause();v.currentTime=+V["in"]||0}catch(e){}v.__t=setTimeout(function(){v.playbackRate=+V.rate||1;var pp=v.play();if(pp&&pp.catch)pp.catch(function(){})},Math.max(0,(+V.start||0)*1000))});liveGo(r)}
function pvAdvance(){if(PB.r&&PB.f&&PB.f.pb&&PB.f.pb.present.mode==="click"&&!PB.played&&moving(PB.r,PB.f)){pvGo();return true}return false}
function liveGo(r){var nodes=r.querySelectorAll('[data-layer-kind="live"][data-live]');if(!nodes.length)return;Promise.all([loadN("/musa/video-live-core.js","MusaVideoLive"),loadN("/musa/design-code-core.js","MusaDesignCode")]).then(function(){var ML=window.MusaVideoLive,DC=window.MusaDesignCode;if(PB.r!==r)return;[].forEach.call(nodes,function(n){var L=DC.decLive(n.getAttribute("data-live"));if(!L)return;var w=n.offsetWidth||L.W||400,h=n.offsetHeight||L.H||400,W=L.fit==="canvas"?L.W:Math.round(w),H=L.fit==="canvas"?L.H:Math.round(h);var cv=document.createElement("canvas");cv.style.cssText="position:absolute;inset:0;width:100%;height:100%;pointer-events:none";if(getComputedStyle(n).position==="static")n.style.position="relative";n.appendChild(cv);try{var cli=ML.client({src:ML.runSrc(L),kind:L.kind||"html",sel:L.sel!=null?+L.sel:-1,ov:ML.ovOf(L.src)||{},W:W,H:H,fps:30,dur:30,r3:ML.usesR3(L),frameUrl:"/musa/live-frame.html"});PB.lives.push({n:n,cv:cv,L:L,cli:cli,busy:false})}catch(e){}});(function tick(){if(PB.r!==r)return;var t=PB.played?(performance.now()-PB.t0)/1000:(PB.f&&PB.f.pb?PB.f.pb.poster:0);PB.lives.forEach(function(x){if(x.busy)return;x.busy=true;x.cli.frame(DC.liveTime(x.L,t),{lt:Math.max(0,t-(+x.L.start||0))}).then(function(fr){x.busy=false;if(fr&&fr.bmp){if(x.cv.width!==fr.w||x.cv.height!==fr.h){x.cv.width=fr.w;x.cv.height=fr.h}x.cv.getContext("2d").drawImage(fr.bmp,0,0);try{fr.bmp.close()}catch(e){}var im=x.n.querySelector("img[data-live-poster]");if(im)im.style.visibility="hidden"}},function(){x.busy=false})});PB.raf=requestAnimationFrame(tick)})()},function(){})}

function stage(f,maxW,maxH){var s=Math.min(1,maxW/f.w,maxH?maxH/f.h:1),o=document.createElement("div");o.className="stage";o.style.width=f.w*s+"px";o.style.height=f.h*s+"px";var i=document.createElement("div");i.style.cssText="position:absolute;left:0;top:0;width:"+f.w+"px;height:"+f.h+"px;transform-origin:0 0;transform:scale("+s+")";i.appendChild(root(f));o.appendChild(i);return o}
function toast(m){var t=$("toast");t.textContent=m;t.classList.add("on");clearTimeout(toast.t);toast.t=setTimeout(function(){t.classList.remove("on")},2600)}
var NONCE=(document.querySelector("script[nonce]")||{}).nonce||"";
function loadN(src,g){if(window[g])return Promise.resolve(window[g]);return new Promise(function(ok,ko){var s=document.createElement("script");s.src=src;s.setAttribute("nonce",NONCE);s.onload=function(){ok(window[g])};s.onerror=function(){ko(new Error("no cargó "+src))};document.head.appendChild(s)})}
function waitImgs(el){return Promise.all([].map.call(el.querySelectorAll("img"),function(im){return im.complete?0:new Promise(function(r){im.onload=im.onerror=r;setTimeout(r,8000)})}))}
function shot(f,scale){return loadN("/musa/vendor/html2canvas.min.js","html2canvas").then(function(){var host=document.createElement("div");host.style.cssText="position:fixed;left:0;top:0;z-index:-1;pointer-events:none;width:"+f.w+"px;height:"+f.h+"px;overflow:hidden";var r=root(f);staticR(r,f);r.style.position="relative";r.style.width=f.w+"px";r.style.height=f.h+"px";host.appendChild(r);document.body.appendChild(host);return waitImgs(r).then(function(){return vidImgs(r,f)}).then(function(){return document.fonts&&document.fonts.ready}).then(function(){return html2canvas(r,{useCORS:true,backgroundColor:f.bg||"#ffffff",scale:scale,width:f.w,height:f.h,logging:false})}).then(function(c){host.remove();return c},function(e){host.remove();throw e})})}
function safe(n){return String(n||"diseno").replace(/[\\/:*?"<>|]+/g,"-").slice(0,80)}
function save(name,blob){var a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.style.display="none";document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},4000)}
function busy(b,on,txt){b.disabled=on;b.textContent=on?T.busy:txt}
function png(i,b){var f=D.frames[i],txt=b.textContent;busy(b,true,txt);shot(f,Math.min(3,Math.max(1,2160/Math.max(f.w,f.h)))).then(function(c){c.toBlob(function(bl){save(safe(D.name)+(D.frames.length>1?"-"+(i+1):"")+".png",bl);busy(b,false,txt);toast(T.done)},"image/png")},function(e){busy(b,false,txt);toast(T.fail+(e&&e.message||e))})}
function pdf(b){var txt=b.textContent;busy(b,true,txt);loadN("/musa/vendor/jspdf.umd.min.js","jspdf").then(function(){var J=null,i=0;function next(){if(i>=D.frames.length){save(safe(D.name)+".pdf",J.output("blob"));busy(b,false,txt);toast(T.done);return}var f=D.frames[i++];b.textContent=T.busy+" "+i+" "+T.of+" "+D.frames.length;return shot(f,Math.min(2,Math.max(1,1600/Math.max(f.w,f.h)))).then(function(c){var o=f.w>=f.h?"l":"p";if(!J)J=new window.jspdf.jsPDF({unit:"px",format:[f.w,f.h],orientation:o,hotfixes:["px_scaling"]});else J.addPage([f.w,f.h],o);J.addImage(c.toDataURL("image/jpeg",0.92),"JPEG",0,0,f.w,f.h);return next()})}return next()}).catch(function(e){busy(b,false,txt);toast(T.fail+(e&&e.message||e))})}
var P={i:0};
function pv(){var f=D.frames[P.i],box=$("pvStage");pvStop();box.innerHTML="";box.appendChild(stage(f,innerWidth*0.96,innerHeight*0.9));pvPlay(f,box.querySelector("[data-tf]"));$("pvN").textContent=(P.i+1)+" / "+D.frames.length}
function pvOpen(){P.i=0;$("pv").classList.add("on");pv();try{var el=document.documentElement;(el.requestFullscreen||el.webkitRequestFullscreen||function(){}).call(el)}catch(e){}}
function pvClose(){pvStop();$("pv").classList.remove("on");try{if(document.fullscreenElement)document.exitFullscreen()}catch(e){}}
$("pv").addEventListener("click",function(e){if(e.target.closest("#pvX"))return pvClose();if(e.clientX>=innerWidth/3&&pvAdvance())return;P.i=(P.i+(e.clientX<innerWidth/3?D.frames.length-1:1))%D.frames.length;pv()});
document.addEventListener("keydown",function(e){if(!$("pv").classList.contains("on"))return;if(e.key==="Escape")return pvClose();if(e.key==="ArrowRight"||e.key===" "){if(pvAdvance())return;P.i=(P.i+1)%D.frames.length;pv()}if(e.key==="ArrowLeft"){P.i=(P.i+D.frames.length-1)%D.frames.length;pv()}});
addEventListener("resize",function(){if($("pv").classList.contains("on"))pv()});
var LKEY="musa-v-lead:"+location.pathname,pending=null;
function unlocked(){if(window.__ldOk)return true;try{return sessionStorage.getItem(LKEY)==="1"}catch(e){return false}}
function setUnlocked(){window.__ldOk=true;try{sessionStorage.setItem(LKEY,"1")}catch(e){}}
function gate(fn){if(D.mode!=="lead"||unlocked())return fn();pending=fn;$("ldEr").textContent="";$("ld").classList.add("on");setTimeout(function(){try{$("ldF").elements.name.focus()}catch(e){}},30)}
$("ldT").textContent=T.lTitle;$("ldS").textContent=T.lSub;$("ldN").textContent=T.lName;$("ldE").textContent=T.lEmail;$("ldC").textContent=T.lCompany;$("ldGo").textContent=T.lGo;$("ldX").textContent=T.lCancel;
$("ldX").onclick=function(){$("ld").classList.remove("on");pending=null};
$("ldF").onsubmit=function(e){e.preventDefault();var f=$("ldF"),go=$("ldGo"),d={name:f.elements.name.value,email:f.elements.email.value,company:f.elements.company.value,website:f.elements.website.value,qr:D.qr};go.disabled=true;$("ldEr").textContent="";
fetch(location.pathname.replace(/\/+$/,"")+"/lead",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||"Error");return j})}).then(function(){setUnlocked();$("ld").classList.remove("on");go.disabled=false;var p=pending;pending=null;if(p)p()},function(x){go.disabled=false;$("ldEr").textContent=x.message})};
var n=D.frames.length;
$("ttl").innerHTML="";var h=document.createElement("span");h.textContent=D.name;$("ttl").appendChild(h);var sm=document.createElement("small");sm.textContent=n+" "+(n===1?T.n1:T.nn);$("ttl").appendChild(sm);
$("bPdf").textContent=n>1?T.all:T.pdf;$("bPdf").onclick=function(){var b=this;gate(function(){pdf(b)})};
if(D.mode==="view"){$("bPdf").hidden=true;var vo=document.createElement("span");vo.className="vo";vo.textContent=T.view;$("bPres").parentNode.insertBefore(vo,$("bPres"))}
$("pvX").textContent=T.close;
if(n>1||D.present){$("bPres").hidden=false;$("bPres").textContent=T.pres;$("bPres").onclick=pvOpen}
if(D.truncated){$("trunc").hidden=false;$("trunc").textContent=T.trunc}
var list=$("list");
D.frames.forEach(function(f,i){var c=document.createElement("div");c.className="fr";var w=Math.min(948,innerWidth-32);c.appendChild(stage(f,w,null));var bar=document.createElement("div");bar.className="bar";var s=document.createElement("span");s.textContent=(n>1?(i+1)+" · ":"")+f.name+" · "+f.w+"×"+f.h;bar.appendChild(s);if(D.mode!=="view"){var b=document.createElement("button");b.className="b";b.textContent=T.png;b.onclick=function(){gate(function(){png(i,b)})};bar.appendChild(b)}c.appendChild(bar);list.appendChild(c)});
if(D.present&&n>0)setTimeout(function(){$("bPres").focus()},0);
})();`;
