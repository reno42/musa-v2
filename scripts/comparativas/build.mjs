// Genera las comparativas estáticas en inglés (/compare/) y español (/comparar/) + sitemap con hreflang.
// Uso: node scripts/comparativas/build.mjs
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SITE, UPDATED, UPDATED_LABEL, CAPS, MUSA, COMPETITORS, HUB_FAQ } from "./data.mjs";
import { UPDATED_LABEL_EN, CAPS_EN, MUSA_EN, GROUP_EN, COMPETITORS_EN, SOURCE_TITLE_EN, HUB_FAQ_EN } from "./data-en.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const short = (c) => c.short || c.name;
const parse = (v) => { const [k, ...rest] = String(v || "n").split("|"); return { k, note: rest.join("|") }; };
const lc = (s) => s.charAt(0).toLowerCase() + s.slice(1);

/* ── textos de la interfaz por idioma ── */
const L = {
  es: {
    lang: "es", locale: "es_LA", dir: "comparar", updated: UPDATED_LABEL, yes: "Sí", partial: "Parcial", no: "No", nameNo: "No",
    caps: (k) => CAPS.find((c) => c[0] === k).slice(1),
    musa: (k) => MUSA.caps[k], comp: (c) => c, group: (g) => g, src: (t) => t, faqHub: HUB_FAQ,
    nav: "Comparativas", cta: "Crear cuenta", ctaBig: "Empezar gratis", bandTitle: "Todo tu contenido,<br/>en un solo lugar.",
    home: "Musa", hubCrumb: "Comparativas",
    footAbout: "La plataforma de contenido de Futuraria: planea, crea, publica, conversa, pauta, vende y mide para todas tus marcas, con tu equipo y tus agentes de IA.",
    fProduct: "Producto", fHome: "Inicio", fSignin: "Entrar", fAgents: "Para agentes de IA", fCompare: "Comparar", fAll: "Musa vs todos",
    legal: `© 2026 Futuraria. Canva, Adobe, Figma, Hootsuite, HubSpot y demás nombres son marcas de sus respectivos dueños; Musa no está afiliada a ellas. Comparación basada en información pública revisada en ${UPDATED_LABEL}; los precios son de lista en USD y pueden cambiar.`,
    other: "English", otherLang: "en",
    // competidor
    title: (s) => `Musa vs ${s}: comparación 2026, funciones y precios`,
    desc: (s) => `Musa vs ${s}: qué hace cada uno, tabla de funciones, precios de ${s} en 2026 y cuándo conviene cada uno. Alternativa a ${s} para freelancers, agencias y empresas.`,
    answer: (c, cc, s) => `${c.name}: ${cc.one} Musa es una plataforma de contenido que une diseño, video, publicación, bandeja de mensajes, pauta, CRM, portal de clientes y agentes de IA para varias marcas. Elige ${s} ${lc(cc.chooseThem)} Elige Musa ${lc(cc.chooseUs)}`,
    leadSuffix: "Así se compara con Musa.", updatedLbl: "Actualizado", shortAnswer: "Respuesta corta",
    covers: (s) => `${s} cubre`, coversNote: "de las áreas que cubre Musa (parcial cuenta como medio).", priceOf: (s) => `Precio de ${s}`, has: (s) => `Lo que tiene ${s}`, hasNone: "Ninguna de las áreas completas; ver tabla",
    tableTitle: (s) => `Tabla comparativa: Musa vs ${s}`, fn: "Función", winUs: "Dónde gana Musa", winThem: (s) => `Dónde gana ${s}`,
    chooseThem: (s) => `Elige ${s} si…`, chooseUs: "Elige Musa si…", together: (s) => `Usar Musa y ${s} juntos`,
    faq: "Preguntas frecuentes", others: "Otras comparativas", seeAll: "Ver todas", sources: "Fuentes",
    sourcesNote: `Revisado en ${UPDATED_LABEL}. Si algo cambió, escríbenos a <a href="mailto:soporte@futuraria.com">soporte@futuraria.com</a> y lo corregimos.`,
    faqC: (c, cc, s, missing) => [
      [`¿Cuál es la diferencia entre Musa y ${s}?`, `${c.name}: ${cc.one} Musa reúne diseño, video, calendario y publicación, bandeja, pauta, CRM, portal de clientes y agentes de IA vía MCP en una sola plataforma para varias marcas.`],
      [`¿Musa es una alternativa a ${s}?`, `Sí, ${lc(cc.chooseUs)} ${s} sigue siendo mejor opción ${lc(cc.chooseThem)}`],
      [`¿Cuánto cuesta ${s}?`, `Según su información pública revisada en ${UPDATED_LABEL}: ${cc.price}. Verifica el precio vigente en su web.`],
      [`¿Puedo usar Musa y ${s} juntos?`, cc.together],
      [`¿Qué tiene Musa que ${s} no tiene?`, missing.length ? `Según la información pública de ${s}, no incluye: ${missing.join(", ")}. Musa incluye todo eso.` : cc.weWin.join(" ")],
    ],
    // hub
    hubTitle: "Musa vs Canva, Adobe, Figma, Hootsuite y más: comparativa 2026",
    hubDesc: "Comparamos Musa con Canva, Adobe Express, Figma, Pencil, Paper, VectorCraft, Kittl, Lovart, Pomelli, Hootsuite, Sprout Social, Metricool, Buffer, Later, HubSpot y Jasper: funciones, precios y cuándo elegir cada uno.",
    hubTag: "Comparativas", hubH1: "Musa <em>vs</em> todos",
    hubLead: (n) => `Para producir contenido de una marca hoy se pagan cuatro o cinco herramientas: una para diseñar, otra para programar redes, otra para responder mensajes, otra para la pauta y un CRM. Musa las reúne en una sola. Aquí lo comparamos, con honestidad, con ${n} alternativas.`,
    hubSrc: "Información pública de cada producto, fuentes en cada comparación.",
    hubAnswer: (n) => `Canva, Adobe, Figma, Kittl y VectorCraft son herramientas para diseñar. Pencil, Paper, Lovart y Pomelli diseñan con IA o con agentes. Hootsuite, Sprout Social, Metricool, Buffer y Later programan y miden redes. HubSpot es un CRM con marketing y Jasper escribe con IA. Musa es la única de la lista que cubre las ${n} áreas: diseño, video, publicación, bandeja, pauta, CRM, varias marcas, portal de clientes, agentes de IA vía MCP, BYOK, automatizaciones, reportes y gobierno corporativo.`,
    bigTable: "La tabla grande", hint: "Desliza hacia el lado para ver todas. Toca el nombre de cada herramienta para ver su comparación completa.",
    total: (n) => `Áreas cubiertas (de ${n})`, legend: "lo hace completo", legendP: "lo hace limitado, con otro producto o solo en planes altos", legendN: "no lo hace",
    oneByOne: "Cada comparación, una por una", seeCmp: "Ver comparación →", rows: "Qué significa cada fila",
    mdTitle: "Musa vs la competencia", mdSrc: "Comparativa de Musa by Futuraria con", mdPrice: "Precio de", mdThem: "Elige", mdIf: "si", mdUs: "Elige Musa si", mdTog: "Juntos", mdFaq: "Preguntas frecuentes",
  },
  en: {
    lang: "en", locale: "en_US", dir: "compare", updated: UPDATED_LABEL_EN, yes: "Yes", partial: "Partial", no: "No",
    caps: (k) => CAPS_EN[k], musa: (k) => "y|" + MUSA_EN[k],
    comp: (c) => { const e = COMPETITORS_EN[c.slug]; return { ...c, ...e, caps: Object.fromEntries(Object.entries(c.caps).map(([k, v]) => { const p = parse(v); return [k, p.k + (e.caps[k] ? "|" + e.caps[k] : "")]; })) }; },
    group: (g) => GROUP_EN[g] || g, src: SOURCE_TITLE_EN, faqHub: HUB_FAQ_EN,
    nav: "Comparisons", cta: "Create account", ctaBig: "Start free", bandTitle: "All your content,<br/>in one place.",
    home: "Musa", hubCrumb: "Comparisons",
    footAbout: "Futuraria's content platform: plan, create, publish, converse, advertise, sell and measure for all your brands, with your team and your AI agents.",
    fProduct: "Product", fHome: "Home", fSignin: "Sign in", fAgents: "For AI agents", fCompare: "Compare", fAll: "Musa vs everyone",
    legal: `© 2026 Futuraria. Canva, Adobe, Figma, Hootsuite, HubSpot and other names are trademarks of their respective owners; Musa is not affiliated with them. Comparison based on public information reviewed in ${UPDATED_LABEL_EN}; prices are list prices in USD and may change.`,
    other: "Español", otherLang: "es",
    title: (s) => `Musa vs ${s}: 2026 comparison, features and pricing`,
    desc: (s) => `Musa vs ${s}: what each one does, feature table, ${s} pricing in 2026 and when each one fits. A ${s} alternative for freelancers, agencies and companies.`,
    answer: (c, cc, s) => `${c.name}: ${cc.one} Musa is a content platform that brings together design, video, publishing, a message inbox, ads, CRM, a client portal and AI agents for multiple brands. Choose ${s} ${lc(cc.chooseThem)} Choose Musa ${lc(cc.chooseUs)}`,
    leadSuffix: "Here's how it compares with Musa.", updatedLbl: "Updated", shortAnswer: "Short answer",
    covers: (s) => `${s} covers`, coversNote: "of the areas Musa covers (partial counts as half).", priceOf: (s) => `${s} pricing`, has: (s) => `What ${s} has`, hasNone: "None of the areas fully; see the table",
    tableTitle: (s) => `Comparison table: Musa vs ${s}`, fn: "Feature", winUs: "Where Musa wins", winThem: (s) => `Where ${s} wins`,
    chooseThem: (s) => `Choose ${s} if…`, chooseUs: "Choose Musa if…", together: (s) => `Using Musa and ${s} together`,
    faq: "Frequently asked questions", others: "Other comparisons", seeAll: "See all", sources: "Sources",
    sourcesNote: `Reviewed in ${UPDATED_LABEL_EN}. If something changed, write to <a href="mailto:soporte@futuraria.com">soporte@futuraria.com</a> and we'll fix it.`,
    faqC: (c, cc, s, missing) => [
      [`What's the difference between Musa and ${s}?`, `${c.name}: ${cc.one} Musa brings design, video, calendar and publishing, inbox, ads, CRM, client portal and AI agents via MCP into one platform for multiple brands.`],
      [`Is Musa an alternative to ${s}?`, `Yes, ${lc(cc.chooseUs)} ${s} is still the better option ${lc(cc.chooseThem)}`],
      [`How much does ${s} cost?`, `According to its public information reviewed in ${UPDATED_LABEL_EN}: ${cc.price}. Check the current price on its website.`],
      [`Can I use Musa and ${s} together?`, cc.together],
      [`What does Musa have that ${s} doesn't?`, missing.length ? `According to ${s}'s public information, it doesn't include: ${missing.join(", ")}. Musa includes all of that.` : cc.weWin.join(" ")],
    ],
    hubTitle: "Musa vs Canva, Adobe, Figma, Hootsuite and more: 2026 comparison",
    hubDesc: "We compare Musa with Canva, Adobe Express, Figma, Pencil, Paper, VectorCraft, Kittl, Lovart, Pomelli, Hootsuite, Sprout Social, Metricool, Buffer, Later, HubSpot and Jasper: features, pricing and when to choose each one.",
    hubTag: "Comparisons", hubH1: "Musa <em>vs</em> everyone",
    hubLead: (n) => `Producing a brand's content today means paying for four or five tools: one to design, one to schedule social posts, one to answer messages, one for ads and a CRM. Musa brings them into one. Here we compare it, honestly, with ${n} alternatives.`,
    hubSrc: "Public information for each product, sources in each comparison.",
    hubAnswer: (n) => `Canva, Adobe, Figma, Kittl and VectorCraft are design tools. Pencil, Paper, Lovart and Pomelli design with AI or agents. Hootsuite, Sprout Social, Metricool, Buffer and Later schedule and measure social media. HubSpot is a CRM with marketing and Jasper writes with AI. Musa is the only one on the list that covers all ${n} areas: design, video, publishing, inbox, ads, CRM, multiple brands, client portal, AI agents via MCP, BYOK, automations, reporting and corporate governance.`,
    bigTable: "The big table", hint: "Scroll sideways to see them all. Tap a tool's name to see its full comparison.",
    total: (n) => `Areas covered (of ${n})`, legend: "does it fully", legendP: "does it partly, with another product or only on higher plans", legendN: "doesn't do it",
    oneByOne: "Every comparison, one by one", seeCmp: "See comparison →", rows: "What each row means",
    mdTitle: "Musa vs the competition", mdSrc: "Comparison of Musa by Futuraria with", mdPrice: "Price of", mdThem: "Choose", mdIf: "if", mdUs: "Choose Musa if", mdTog: "Together", mdFaq: "FAQ",
  },
};

const pageUrl = (T, c) => `${SITE}/${T.dir}/musa-vs-${c.slug}/`;
const hubUrl = (T) => `${SITE}/${T.dir}/`;
const lab = (T, k) => ({ y: T.yes, p: T.partial, n: T.no })[k];
const mark = (T, v, withNote = false) => { const { k, note } = parse(v); const t = `<span class="m m-${k}" title="${esc(note || lab(T, k))}">${lab(T, k)}</span>`; return withNote && note ? `${t}<small>${esc(note)}</small>` : t; };
const score = (T, caps) => String(CAPS.reduce((n, [key]) => n + ({ y: 1, p: 0.5, n: 0 })[parse(caps[key]).k], 0)).replace(".", T.lang === "es" ? "," : ".");

function head(T, { title, desc, url, alt, ld }) {
  const O = L[T.otherLang];
  return `<!doctype html>
<html lang="${T.lang}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}" />
<link rel="canonical" href="${url}" />
<link rel="alternate" hreflang="${T.lang}" href="${url}" />
<link rel="alternate" hreflang="${O.lang}" href="${alt}" />
<link rel="alternate" hreflang="x-default" href="${T.lang === "en" ? url : alt}" />
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large" />
<meta property="og:type" content="article" />
<meta property="og:locale" content="${T.locale}" />
<meta property="og:locale:alternate" content="${O.locale}" />
<meta property="og:site_name" content="Musa by Futuraria" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:url" content="${url}" />
<meta name="twitter:card" content="summary" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(desc)}" />
<meta property="article:modified_time" content="${UPDATED}" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;700&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/comparar/comparar.css" />
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>
</head>
<body>
<nav class="nav"><a class="logo" href="/?lang=${T.lang}">MUSA<i>#</i><small>by Futuraria</small></a>
<div class="nav-act"><span class="musa-lang" role="group" aria-label="Language"><a class="on" href="${url}" hreflang="${T.lang}">${T.lang.toUpperCase()}</a><a href="${alt}" hreflang="${O.lang}" lang="${O.lang}" title="${O.other === "English" ? "Español" : "English"}">${O.lang.toUpperCase()}</a></span><a class="btn ghost" href="/${T.dir}/">${T.nav}</a><a class="btn solid" href="/?lang=${T.lang}&signup=1">${T.cta}</a></div></nav>
`;
}
function footer(T) {
  const links = COMPETITORS.map((c) => `<li><a href="/${T.dir}/musa-vs-${c.slug}/">Musa vs ${esc(short(c))}</a></li>`).join("");
  return `
<section class="band"><div><h2>${T.bandTitle}</h2><a class="btn big" href="/?lang=${T.lang}&signup=1">${T.ctaBig}</a></div></section>
<footer class="foot">
  <div class="foot-brand"><a class="logo" href="/?lang=${T.lang}">MUSA<i>#</i></a><p>${T.footAbout}</p></div>
  <div><h4>${T.fProduct}</h4><ul><li><a href="/?lang=${T.lang}">${T.fHome}</a></li><li><a href="/?lang=${T.lang}&signup=1">${T.cta}</a></li><li><a href="/?lang=${T.lang}&signin=1">${T.fSignin}</a></li><li><a href="/agents/">${T.fAgents}</a></li><li><a href="/llms.txt">llms.txt</a></li></ul></div>
  <div class="foot-cmp"><h4>${T.fCompare}</h4><ul><li><a href="/${T.dir}/">${T.fAll}</a></li>${links}</ul></div>
  <div><h4>Futuraria</h4><ul><li><a href="mailto:soporte@futuraria.com">soporte@futuraria.com</a></li><li><a href="https://futuraria.com">futuraria.com</a></li><li><a href="/${L[T.otherLang].dir}/">${T.other}</a></li></ul></div>
  <p class="foot-legal">${T.legal}</p>
</footer>
</body>
</html>
`;
}

const org = { "@type": "Organization", "@id": `${SITE}/#org`, name: "Futuraria", url: "https://futuraria.com", email: "soporte@futuraria.com" };
const app = (T) => ({
  "@type": "SoftwareApplication", "@id": `${SITE}/#musa`, name: "Musa", applicationCategory: "BusinessApplication", operatingSystem: "Web",
  url: `${SITE}/`, publisher: { "@id": `${SITE}/#org` }, inLanguage: ["en", "es"],
  description: T.lang === "es"
    ? "Plataforma de contenido para freelancers, agencias y empresas: diseño, video, calendario y publicación en redes, bandeja de mensajes, pauta, CRM, portal de clientes y agentes de IA vía MCP, con BYOK."
    : "Content platform for freelancers, agencies and companies: design, video, social calendar and publishing, message inbox, ads, CRM, client portal and AI agents via MCP, with BYOK.",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  featureList: CAPS.map(([k]) => T.caps(k)[0]).join(", "),
});
const faqLd = (faq) => ({ "@type": "FAQPage", mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) });
const crumbs = (items) => ({ "@type": "BreadcrumbList", itemListElement: items.map(([name, item], i) => ({ "@type": "ListItem", position: i + 1, name, item })) });
const faqHtml = (T, faq) => `<section class="sec" id="faq"><h2>${T.faq}</h2>${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}</section>`;

function competitorPage(T, c0) {
  const c = T.comp(c0), s = short(c), url = pageUrl(T, c), alt = pageUrl(L[T.otherLang], c);
  const yes = CAPS.filter(([k]) => parse(c.caps[k]).k === "y").map(([k]) => lc(T.caps(k)[0]));
  const missing = CAPS.filter(([k]) => parse(c.caps[k]).k === "n").map(([k]) => lc(T.caps(k)[0]));
  const title = T.title(s), desc = T.desc(s).slice(0, 300), faq = T.faqC(c, c, s, missing);
  const ld = { "@context": "https://schema.org", "@graph": [
    org, app(T),
    { "@type": "Article", headline: title, description: desc, inLanguage: T.lang, dateModified: UPDATED, datePublished: UPDATED, mainEntityOfPage: url, author: { "@id": `${SITE}/#org` }, publisher: { "@id": `${SITE}/#org` }, about: [{ "@id": `${SITE}/#musa` }, { "@type": "SoftwareApplication", name: c.name, url: c.url }] },
    crumbs([[T.home, `${SITE}/`], [T.hubCrumb, hubUrl(T)], [`Musa vs ${s}`, url]]),
    faqLd(faq),
  ] };
  const rows = CAPS.map(([k]) => { const [l, d] = T.caps(k); return `<tr><th scope="row">${esc(l)}<small>${esc(d)}</small></th><td>${mark(T, T.musa(k), true)}</td><td>${mark(T, c.caps[k], true)}</td></tr>`; }).join("");
  const others = COMPETITORS.filter((o) => o.slug !== c.slug && o.group === c.group).concat(COMPETITORS.filter((o) => o.slug !== c.slug && o.group !== c.group)).slice(0, 6);
  return head(T, { title, desc, url, alt, ld }) + `<main class="wrap">
<p class="crumbs"><a href="/?lang=${T.lang}">Musa</a> › <a href="/${T.dir}/">${T.hubCrumb}</a> › Musa vs ${esc(s)}</p>
<header class="hero"><span class="tag">${esc(T.group(c.group))}</span><h1>Musa <em>vs</em> ${esc(s)}</h1>
<p class="lead">${esc(c.one)} ${T.leadSuffix}</p><p class="upd">${T.updatedLbl}: <time datetime="${UPDATED}">${T.updated}</time></p></header>
<section class="answer" aria-label="${T.shortAnswer}"><h2>${T.shortAnswer}</h2><p>${esc(T.answer(c, c, s))}</p></section>
<div class="facts">
  <div><h3>${esc(T.covers(s))}</h3><p class="big">${score(T, c.caps)}<span>/ ${CAPS.length}</span></p><p>${T.coversNote}</p></div>
  <div><h3>${esc(T.priceOf(s))}</h3><p>${esc(c.price)}</p></div>
  <div><h3>${esc(T.has(s))}</h3><p>${esc(yes.length ? yes.join(", ") : T.hasNone)}.</p></div>
</div>
<section class="sec"><h2>${esc(T.tableTitle(s))}</h2>
<div class="tbl-wrap"><table class="tbl two"><thead><tr><th scope="col">${T.fn}</th><th scope="col" class="musa">Musa</th><th scope="col">${esc(s)}</th></tr></thead><tbody>${rows}</tbody></table></div></section>
<section class="sec cols">
  <div class="card"><h2>${T.winUs}</h2><ul>${c.weWin.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
  <div class="card light"><h2>${esc(T.winThem(s))}</h2><ul>${c.theyWin.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
</section>
<section class="sec cols">
  <div><h2>${esc(T.chooseThem(s))}</h2><p>${esc(c.chooseThem)}</p></div>
  <div><h2>${T.chooseUs}</h2><p>${esc(c.chooseUs)}</p></div>
</section>
<section class="sec"><h2>${esc(T.together(s))}</h2><p>${esc(c.together)}</p></section>
${faqHtml(T, faq)}
<section class="sec"><h2>${T.others}</h2><ul class="chips">${others.map((o) => `<li><a href="/${T.dir}/musa-vs-${o.slug}/">Musa vs ${esc(short(o))}</a></li>`).join("")}<li><a href="/${T.dir}/">${T.seeAll}</a></li></ul></section>
<section class="sec src"><h2>${T.sources}</h2><ul>${c0.sources.map(([t, u]) => `<li><a href="${esc(u)}" rel="nofollow noopener" target="_blank">${esc(T.src(t))}</a></li>`).join("")}</ul>
<p>${T.sourcesNote}</p></section>
</main>` + footer(T);
}

function hubPage(T) {
  const url = hubUrl(T), alt = hubUrl(L[T.otherLang]);
  const comps = COMPETITORS.map((c) => T.comp(c));
  const groups = [...new Set(COMPETITORS.map((c) => c.group))];
  const ld = { "@context": "https://schema.org", "@graph": [
    org, app(T),
    { "@type": "CollectionPage", name: T.hubTitle, description: T.hubDesc, url, inLanguage: T.lang, dateModified: UPDATED, about: { "@id": `${SITE}/#musa` } },
    { "@type": "ItemList", name: T.hubTitle, itemListElement: comps.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: `Musa vs ${short(c)}`, url: pageUrl(T, c) })) },
    crumbs([[T.home, `${SITE}/`], [T.hubCrumb, url]]),
    faqLd(T.faqHub),
  ] };
  const thead = `<tr><th scope="col">${T.fn}</th><th scope="col" class="musa">Musa</th>${comps.map((c) => `<th scope="col"><a href="/${T.dir}/musa-vs-${c.slug}/">${esc(short(c))}</a></th>`).join("")}</tr>`;
  const musaCaps = Object.fromEntries(CAPS.map(([k]) => [k, T.musa(k)]));
  const body = CAPS.map(([k]) => { const [l, d] = T.caps(k); return `<tr><th scope="row" title="${esc(d)}">${esc(l)}</th><td class="musa">${mark(T, musaCaps[k])}</td>${comps.map((c) => `<td>${mark(T, c.caps[k])}</td>`).join("")}</tr>`; }).join("")
    + `<tr class="tot"><th scope="row">${T.total(CAPS.length)}</th><td class="musa"><b>${score(T, musaCaps)}</b></td>${comps.map((c) => `<td><b>${score(T, c.caps)}</b></td>`).join("")}</tr>`;
  const cards = groups.map((g) => `<h3 class="grp">${esc(T.group(g))}</h3><div class="grid">${comps.filter((c) => c.group === g).map((c) => `<a class="ccard" href="/${T.dir}/musa-vs-${c.slug}/"><span class="tag">${score(T, c.caps)} / ${CAPS.length}</span><h4>Musa vs ${esc(short(c))}</h4><p>${esc(c.one)}</p><p class="price">${esc(c.price)}</p><span class="more">${T.seeCmp}</span></a>`).join("")}</div>`).join("");
  return head(T, { title: T.hubTitle, desc: T.hubDesc, url, alt, ld }) + `<main class="wrap">
<p class="crumbs"><a href="/?lang=${T.lang}">Musa</a> › ${T.hubCrumb}</p>
<header class="hero"><span class="tag">${T.hubTag} ${UPDATED.slice(0, 4)}</span><h1>${T.hubH1}</h1>
<p class="lead">${T.hubLead(COMPETITORS.length)}</p>
<p class="upd">${T.updatedLbl}: <time datetime="${UPDATED}">${T.updated}</time> · ${T.hubSrc}</p></header>
<section class="answer" aria-label="${T.shortAnswer}"><h2>${T.shortAnswer}</h2><p>${T.hubAnswer(CAPS.length)}</p></section>
<section class="sec"><h2>${T.bigTable}</h2><p class="hint">${T.hint}</p>
<div class="tbl-wrap"><table class="tbl big"><thead>${thead}</thead><tbody>${body}</tbody></table></div>
<p class="legend"><span class="m m-y">${T.yes}</span> ${T.legend} · <span class="m m-p">${T.partial}</span> ${T.legendP} · <span class="m m-n">${T.no}</span> ${T.legendN}</p></section>
<section class="sec"><h2>${T.oneByOne}</h2>${cards}</section>
<section class="sec"><h2>${T.rows}</h2><dl class="defs">${CAPS.map(([k]) => { const [l, d] = T.caps(k); return `<dt>${esc(l)}</dt><dd>${esc(d)}</dd>`; }).join("")}</dl></section>
${faqHtml(T, T.faqHub)}
</main>` + footer(T);
}

function markdown(T) {
  const comps = COMPETITORS.map((c) => T.comp(c));
  const lines = [`# ${T.mdTitle} (${T.updated})`, "", `> ${T.mdSrc} ${COMPETITORS.length}. ${hubUrl(T)}`, ""];
  lines.push(`| ${T.fn} | Musa | ${comps.map(short).join(" | ")} |`, `|---|---|${comps.map(() => "---").join("|")}|`);
  for (const [k] of CAPS) lines.push(`| ${T.caps(k)[0]} | ${T.yes} | ${comps.map((c) => lab(T, parse(c.caps[k]).k)).join(" | ")} |`);
  lines.push("");
  for (const c of comps) lines.push(`## Musa vs ${short(c)}`, "", pageUrl(T, c), "", `- ${c.name}: ${c.one}`, `- ${T.mdPrice} ${short(c)}: ${c.price}`, `- ${T.mdThem} ${short(c)} ${T.mdIf}: ${c.chooseThem}`, `- ${T.mdUs}: ${c.chooseUs}`, `- ${T.mdTog}: ${c.together}`, "");
  lines.push(`## ${T.mdFaq}`, "");
  for (const [q, a] of T.faqHub) lines.push(`**${q}** ${a}`, "");
  return lines.join("\n");
}

for (const T of [L.es, L.en]) {
  const OUT = join(ROOT, "public", T.dir);
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  if (T.lang === "es") writeFileSync(join(OUT, "comparar.css"), readFileSync(join(HERE, "comparar.css"), "utf8"));
  writeFileSync(join(OUT, "index.html"), hubPage(T));
  writeFileSync(join(OUT, T.lang === "es" ? "comparativas.md" : "comparisons.md"), markdown(T));
  for (const c of COMPETITORS) { mkdirSync(join(OUT, `musa-vs-${c.slug}`), { recursive: true }); writeFileSync(join(OUT, `musa-vs-${c.slug}`, "index.html"), competitorPage(T, c)); }
}

// Sitemap con alternativas de idioma (hreflang) para cada par.
const pair = (en, es, p) => [en, es].map((u) => `  <url><loc>${u}</loc><lastmod>${UPDATED}</lastmod><changefreq>monthly</changefreq><priority>${p}</priority>`
  + `<xhtml:link rel="alternate" hreflang="en" href="${en}"/><xhtml:link rel="alternate" hreflang="es" href="${es}"/><xhtml:link rel="alternate" hreflang="x-default" href="${en}"/></url>`).join("\n");
const entries = [
  pair(`${SITE}/?lang=en`, `${SITE}/?lang=es`, "1.0"),
  pair(hubUrl(L.en), hubUrl(L.es), "0.9"),
  ...COMPETITORS.map((c) => pair(pageUrl(L.en, c), pageUrl(L.es, c), "0.8")),
];
writeFileSync(join(ROOT, "public", "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join("\n")}
  <url><loc>${SITE}/compare/comparisons.md</loc><lastmod>${UPDATED}</lastmod><priority>0.6</priority></url>
  <url><loc>${SITE}/comparar/comparativas.md</loc><lastmod>${UPDATED}</lastmod><priority>0.6</priority></url>
  <url><loc>${SITE}/agents/</loc><lastmod>${UPDATED}</lastmod><priority>0.6</priority></url>
  <url><loc>${SITE}/llms.txt</loc><lastmod>${UPDATED}</lastmod><priority>0.6</priority></url>
</urlset>
`);
console.log(`OK: ${COMPETITORS.length} comparativas × 2 idiomas (/compare/ y /comparar/) + sitemap`);
