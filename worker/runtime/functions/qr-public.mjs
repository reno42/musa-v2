// Códigos QR de Musa v2 — lo público, sin cuenta.
//   GET /r/:code  → redirige al destino del QR dinámico y cuenta el escaneo (día, país, tipo de equipo; sin IP).
//                   Pausado o borrado: una página que lo explica (no un JSON ni un 404 pelado como en QeepeR).
//   GET /v/:id    → «ver y descargar» un diseño o presentación compartido (templates.is_public): lo dibuja igual
//                   que el editor (CSS encerrado por frame, HTML limpio con DOMPurify) y deja bajar PNG / PDF y
//                   presentar. Es a donde apunta el QR de un diseño: /c/:id es la página de comentarios y pide cuenta.
import { getSupabaseAdmin } from "../../../api/src/services/supabase.js";

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
  const dest = safeDest(data.url);
  if (!dest) return missing();
  /* 302 y sin caché: si cambias el destino, el próximo escaneo ya va al nuevo (y cada escaneo se cuenta) */
  return new Response(null, { status: 302, headers: { Location: dest, "Cache-Control": "no-store, max-age=0", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" } });
}

/* ═════ /v/:id — ver y descargar un diseño compartido ═════ */
const MAX_FRAMES = 30, MAX_BYTES = 2 * 1024 * 1024;

export async function handleDesignView(request, url) {
  const es = isEs(request);
  const id = decodeURIComponent(url.pathname.slice(3)).replace(/\/+$/, "");
  const gone = () => page(request, 404, es ? "Este diseño ya no está compartido" : "This design is no longer shared",
    es ? "Pídele a quien te lo compartió que lo vuelva a compartir." : "Ask whoever shared it to share it again.");
  if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(id)) return gone();
  const sb = getSupabaseAdmin();
  if (!sb) return page(request, 503, es ? "No pudimos abrir el diseño" : "We couldn't open the design", es ? "Intenta de nuevo en un momento." : "Please try again in a moment.");
  const { data: tpl } = await sb.from("templates").select("id,name,is_public,deleted_at,data").eq("id", id).maybeSingle();
  if (!tpl || tpl.deleted_at || tpl.is_public !== true) return gone();
  let d = tpl.data || {};
  if (typeof d === "string") { try { d = JSON.parse(d); } catch { d = {}; } }
  const raw = Array.isArray(d.frames) && d.frames.length ? d.frames : [{ name: tpl.name, html: d.html || "", css: d.css || "", width: d.width, height: d.height, background: d.background }];
  const frames = []; let bytes = 0;
  for (const f of raw.slice(0, MAX_FRAMES)) {
    const html = typeof f?.html === "string" ? f.html : "", css = typeof f?.css === "string" ? f.css : "";
    if (bytes + html.length + css.length > MAX_BYTES) break;
    bytes += html.length + css.length;
    frames.push({ name: String(f?.name || `Frame ${frames.length + 1}`).slice(0, 120), w: Math.max(1, Math.min(8000, Number(f?.width) || Number(d.width) || 1080)), h: Math.max(1, Math.min(8000, Number(f?.height) || Number(d.height) || 1080)), bg: typeof f?.background === "string" ? f.background : (typeof f?.fill === "string" ? f.fill : "#ffffff"), html, css });
  }
  if (!frames.length) return gone();
  const present = url.searchParams.get("present") === "1";
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const T = es
    ? { pdf: "Descargar PDF", png: "Descargar PNG", pres: "Presentar", all: "Descargar todo en PDF", busy: "Preparando…", done: "Listo", fail: "No se pudo descargar: ", of: "de", made: "Compartido con", n1: "lámina", nn: "láminas", close: "Cerrar", trunc: "Se muestran las primeras láminas del archivo." }
    : { pdf: "Download PDF", png: "Download PNG", pres: "Present", all: "Download all as PDF", busy: "Preparing…", done: "Done", fail: "Couldn't download: ", of: "of", made: "Shared with", n1: "slide", nn: "slides", close: "Close", trunc: "Showing the first slides of the file." };
  /* «<» escapado para que ningún texto cierre el <script> donde va el JSON (JSON.parse lo devuelve igual) */
  const BS = String.fromCharCode(92);
  const payload = JSON.stringify({ name: tpl.name || "Diseño", frames, present, truncated: frames.length < raw.length, T }).split("<").join(BS + "u003c");
  const csp = [
    "default-src 'none'", `script-src 'self' 'nonce-${nonce}'`, "style-src 'self' 'unsafe-inline' https:", "font-src https: data:",
    "img-src https: data: blob:", "media-src https: data: blob:", "connect-src 'self' https: data: blob:", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
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
.toast{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);background:#111;color:#fff;padding:10px 16px;border-radius:50px;font-size:13px;opacity:0;transition:opacity .2s;pointer-events:none;z-index:30}.toast.on{opacity:1}</style>
</head><body>
<div class="top"><h1 id="ttl"></h1><button class="b" id="bPres" hidden></button><button class="b pri" id="bPdf"></button></div>
<p class="note" id="trunc" hidden></p><div class="list" id="list"></div>
<div class="foot">${es ? "Compartido con" : "Shared with"} <a href="/">Musa</a></div>
<div class="pv" id="pv"><button class="b x" id="pvX"></button><div id="pvStage"></div><div class="n" id="pvN"></div></div><div class="toast" id="toast"></div>
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
function root(f){var id="v"+(uid++),r=document.createElement("div");r.setAttribute("data-tf",id);r.style.cssText="position:absolute;inset:0;overflow:hidden;background:"+(f.bg||"#fff");r.innerHTML='<style>'+scopeCss(cleanCss(f.css),SCOPE(id))+"</style>"+cleanHtml(f.html);r.querySelectorAll("img").forEach(function(im){im.crossOrigin="anonymous";if(im.src)im.src=im.src});return r}
function stage(f,maxW,maxH){var s=Math.min(1,maxW/f.w,maxH?maxH/f.h:1),o=document.createElement("div");o.className="stage";o.style.width=f.w*s+"px";o.style.height=f.h*s+"px";var i=document.createElement("div");i.style.cssText="position:absolute;left:0;top:0;width:"+f.w+"px;height:"+f.h+"px;transform-origin:0 0;transform:scale("+s+")";i.appendChild(root(f));o.appendChild(i);return o}
function toast(m){var t=$("toast");t.textContent=m;t.classList.add("on");clearTimeout(toast.t);toast.t=setTimeout(function(){t.classList.remove("on")},2600)}
var NONCE=(document.querySelector("script[nonce]")||{}).nonce||"";
function loadN(src,g){if(window[g])return Promise.resolve(window[g]);return new Promise(function(ok,ko){var s=document.createElement("script");s.src=src;s.setAttribute("nonce",NONCE);s.onload=function(){ok(window[g])};s.onerror=function(){ko(new Error("no cargó "+src))};document.head.appendChild(s)})}
function waitImgs(el){return Promise.all([].map.call(el.querySelectorAll("img"),function(im){return im.complete?0:new Promise(function(r){im.onload=im.onerror=r;setTimeout(r,8000)})}))}
function shot(f,scale){return loadN("/musa/vendor/html2canvas.min.js","html2canvas").then(function(){var host=document.createElement("div");host.style.cssText="position:fixed;left:0;top:0;z-index:-1;pointer-events:none;width:"+f.w+"px;height:"+f.h+"px;overflow:hidden";var r=root(f);r.style.position="relative";r.style.width=f.w+"px";r.style.height=f.h+"px";host.appendChild(r);document.body.appendChild(host);return waitImgs(r).then(function(){return document.fonts&&document.fonts.ready}).then(function(){return html2canvas(r,{useCORS:true,backgroundColor:f.bg||"#ffffff",scale:scale,width:f.w,height:f.h,logging:false})}).then(function(c){host.remove();return c},function(e){host.remove();throw e})})}
function safe(n){return String(n||"diseno").replace(/[\\/:*?"<>|]+/g,"-").slice(0,80)}
function save(name,blob){var a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.style.display="none";document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},4000)}
function busy(b,on,txt){b.disabled=on;b.textContent=on?T.busy:txt}
function png(i,b){var f=D.frames[i],txt=b.textContent;busy(b,true,txt);shot(f,Math.min(3,Math.max(1,2160/Math.max(f.w,f.h)))).then(function(c){c.toBlob(function(bl){save(safe(D.name)+(D.frames.length>1?"-"+(i+1):"")+".png",bl);busy(b,false,txt);toast(T.done)},"image/png")},function(e){busy(b,false,txt);toast(T.fail+(e&&e.message||e))})}
function pdf(b){var txt=b.textContent;busy(b,true,txt);loadN("/musa/vendor/jspdf.umd.min.js","jspdf").then(function(){var J=null,i=0;function next(){if(i>=D.frames.length){save(safe(D.name)+".pdf",J.output("blob"));busy(b,false,txt);toast(T.done);return}var f=D.frames[i++];b.textContent=T.busy+" "+i+" "+T.of+" "+D.frames.length;return shot(f,Math.min(2,Math.max(1,1600/Math.max(f.w,f.h)))).then(function(c){var o=f.w>=f.h?"l":"p";if(!J)J=new window.jspdf.jsPDF({unit:"px",format:[f.w,f.h],orientation:o,hotfixes:["px_scaling"]});else J.addPage([f.w,f.h],o);J.addImage(c.toDataURL("image/jpeg",0.92),"JPEG",0,0,f.w,f.h);return next()})}return next()}).catch(function(e){busy(b,false,txt);toast(T.fail+(e&&e.message||e))})}
var P={i:0};
function pv(){var f=D.frames[P.i],box=$("pvStage");box.innerHTML="";box.appendChild(stage(f,innerWidth*0.96,innerHeight*0.9));$("pvN").textContent=(P.i+1)+" / "+D.frames.length}
function pvOpen(){P.i=0;$("pv").classList.add("on");pv();try{var el=document.documentElement;(el.requestFullscreen||el.webkitRequestFullscreen||function(){}).call(el)}catch(e){}}
function pvClose(){$("pv").classList.remove("on");try{if(document.fullscreenElement)document.exitFullscreen()}catch(e){}}
$("pv").addEventListener("click",function(e){if(e.target.closest("#pvX"))return pvClose();P.i=(P.i+(e.clientX<innerWidth/3?D.frames.length-1:1))%D.frames.length;pv()});
document.addEventListener("keydown",function(e){if(!$("pv").classList.contains("on"))return;if(e.key==="Escape")return pvClose();if(e.key==="ArrowRight"||e.key===" "){P.i=(P.i+1)%D.frames.length;pv()}if(e.key==="ArrowLeft"){P.i=(P.i+D.frames.length-1)%D.frames.length;pv()}});
addEventListener("resize",function(){if($("pv").classList.contains("on"))pv()});
var n=D.frames.length;
$("ttl").innerHTML="";var h=document.createElement("span");h.textContent=D.name;$("ttl").appendChild(h);var sm=document.createElement("small");sm.textContent=n+" "+(n===1?T.n1:T.nn);$("ttl").appendChild(sm);
$("bPdf").textContent=n>1?T.all:T.pdf;$("bPdf").onclick=function(){pdf(this)};
$("pvX").textContent=T.close;
if(n>1||D.present){$("bPres").hidden=false;$("bPres").textContent=T.pres;$("bPres").onclick=pvOpen}
if(D.truncated){$("trunc").hidden=false;$("trunc").textContent=T.trunc}
var list=$("list");
D.frames.forEach(function(f,i){var c=document.createElement("div");c.className="fr";var w=Math.min(948,innerWidth-32);c.appendChild(stage(f,w,null));var bar=document.createElement("div");bar.className="bar";var s=document.createElement("span");s.textContent=(n>1?(i+1)+" · ":"")+f.name+" · "+f.w+"×"+f.h;bar.appendChild(s);var b=document.createElement("button");b.className="b";b.textContent=T.png;b.onclick=function(){png(i,b)};bar.appendChild(b);c.appendChild(bar);list.appendChild(c)});
if(D.present&&n>0)setTimeout(function(){$("bPres").focus()},0);
})();`;
