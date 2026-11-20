// Portada multilenguaje: elige inglés o español y escribe en el HTML (antes de que llegue al navegador)
// el idioma, título, descripción, Open Graph y los hreflang. Así buscadores y motores de IA leen cada versión.
// Idioma: ?lang= → cookie musa_lang (elección manual) → país por IP (Cloudflare) → inglés.

const ES_COUNTRIES = new Set(["ES", "MX", "AR", "CO", "PE", "CL", "VE", "EC", "GT", "CU", "BO", "DO", "HN", "PY", "SV", "NI", "CR", "PA", "UY", "PR", "GQ"]);

const META = {
  en: {
    title: "Musa by Futuraria — The content platform for brands, agencies and AI teams",
    desc: "Musa brings design, video, social calendar and publishing, inbox, ads, CRM and a client portal together for all your brands, with your team and your AI agents (MCP, BYOK). Start free.",
    locale: "en_US",
  },
  es: {
    title: "Musa by Futuraria — Plataforma de contenido para marcas, agencias y equipos con IA",
    desc: "Musa reúne diseño, video, calendario y publicación en redes, bandeja de mensajes, pauta, CRM y portal de clientes para todas tus marcas, con tu equipo y tus agentes de IA (MCP, BYOK). Empieza gratis.",
    locale: "es_LA",
  },
};

function cookie(req, name) {
  const m = (req.headers.get("Cookie") || "").match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}

// ── GA4 server-side (REQ-072 Fase 0) ──
// Inyecta gtag en TODA página HTML pública servida por el worker, con consent
// mode por defecto en denied (RGPD-friendly; se activa por interacción).
// Cero script en el source de la app: se agrega al vuelo vía HTMLRewriter.
const GA4_ID = "G-JYY7GED6W1";
function ga4Snippet() {
  return `<script async src="https://www.googletagmanager.com/gtag/js?id=${GA4_ID}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)};gtag('js',new Date());gtag('config','${GA4_ID}',{anonymize_ip:true});</script>`;
}

// ── Headers SEO + seguridad para HTML público ──
// X-Robots-Tag refuerza el robots del landing (los /compare/ ya llevan el suyo
// del build). Security: enmarcar solo por el propio origen (igual que la
// maqueta), referrer privado y MIME fijo. Solo aplica a navegación de documento.
function seoHeaders(out, request) {
  const dest = request.headers.get("sec-fetch-dest") || "";
  const accept = request.headers.get("accept") || "";
  if (dest && dest !== "document" && dest !== "iframe" && dest !== "frame") return;
  if (!accept.includes("text/html") && !dest) return;
  if (!out.headers.get("content-type")?.includes("text/html")) return;
  out.headers.set("X-Robots-Tag", "index, follow, max-snippet:-1, max-image-preview:large");
  out.headers.set("X-Frame-Options", "SAMEORIGIN");
  out.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  if (!out.headers.get("Content-Security-Policy")) out.headers.set("Content-Security-Policy", "frame-ancestors 'self'");
}

// Passthrough de assets con GA4 + headers SEO para páginas HTML públicas
// (compare, agents, faq, preguntas, guides, legal, docs). No toca /api, /mcp
// ni archivos que no son HTML. Reemplaza al env.ASSETS.fetch directo del final.
export async function serveStaticPage(request, env) {
  const res = await env.ASSETS.fetch(request);
  if (!res || !res.ok) return res;
  const ct = res.headers.get("Content-Type") || "";
  if (!ct.includes("text/html")) return res;
  const out = new Response(res.body, res);
  const re = new HTMLRewriter().on("head", {
    element(e) { e.append(ga4Snippet(), { html: true }); },
  }).transform(out);
  const out2 = new Response(re.body, re);
  seoHeaders(out2, request);
  return out2;
}

export function geoLang(request) {
  const c = (request.cf && request.cf.country) || request.headers.get("CF-IPCountry") || "";
  return ES_COUNTRIES.has(String(c).toUpperCase()) ? "es" : "en";
}

export async function serveRoot(request, env, url) {
  const q = url.searchParams.get("lang");
  const manual = cookie(request, "musa_lang");
  const geo = geoLang(request);
  const lang = q === "en" || q === "es" ? q : manual === "en" || manual === "es" ? manual : geo;
  const m = META[lang];
  // Canonical SIEMPRE al host canónico (www sirve 200 y duplicaría contenido)
  // y SIN query (?lang= es variante de presentación, no URL distinta).
  const u = new URL(request.url);
  const origin = u.hostname.startsWith("www.") ? "https://musaworks.com" : u.origin;
  const canonical = `${origin}/`;

  const asset = await env.ASSETS.fetch(new Request(`${origin}/`, { method: "GET" }));
  if (!asset.ok || !(asset.headers.get("Content-Type") || "").includes("text/html")) return asset;

  const setAttr = (attr, v) => ({ element(e) { e.setAttribute(attr, v); } });
  const res = new HTMLRewriter()
    .on("html", setAttr("lang", lang))
    .on("title", { element(e) { e.setInnerContent(m.title); } })
    .on('meta[name="description"]', setAttr("content", m.desc))
    .on('meta[property="og:title"]', setAttr("content", m.title))
    .on('meta[property="og:description"]', setAttr("content", m.desc))
    .on('meta[property="og:url"]', setAttr("content", canonical))
    .on('meta[name="twitter:title"]', setAttr("content", m.title))
    .on('meta[name="twitter:description"]', setAttr("content", m.desc))
    .on("head", {
      element(e) {
        e.append(
          `<link rel="canonical" href="${canonical}" />` +
          `<link rel="alternate" hreflang="en" href="${origin}/?lang=en" />` +
          `<link rel="alternate" hreflang="es" href="${origin}/?lang=es" />` +
          `<link rel="alternate" hreflang="x-default" href="${origin}/" />` +
          `<meta property="og:url" content="${canonical}" />` +
          `<meta property="og:locale" content="${m.locale}" />` +
          `<meta property="og:locale:alternate" content="${lang === "en" ? META.es.locale : META.en.locale}" />` +
          ga4Snippet(),
          { html: true },
        );
      },
    })
    .transform(asset);

  const out = new Response(res.body, res);
  seoHeaders(out, request);
  out.headers.set("Content-Language", lang);
  out.headers.set("Vary", "Cookie, Accept-Language");
  out.headers.set("Cache-Control", "no-cache");
  // El navegador usa esta cookie si el usuario no eligió idioma a mano.
  if (cookie(request, "musa_geo_lang") !== geo) out.headers.append("Set-Cookie", `musa_geo_lang=${geo}; Path=/; Max-Age=2592000; SameSite=Lax`);
  return out;
}
