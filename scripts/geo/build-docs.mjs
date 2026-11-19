// REQ-072 F2 — docs-driven GEO: publica las 21 skills de .agents/skills/ como
// páginas públicas crawlables en /docs/<modulo>/ (ES fuente + EN).
// Corre en el postbuild DESPUÉS del geo build (lee dist/, escribe dist/docs/).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const SKILLS = join(ROOT, ".agents", "skills");
const DIST = join(ROOT, "dist");
const SITE = "https://musaworks.com";

// estilos alineados con el geo build (landing-static)
const CSS = `body{font-family:Inter,system-ui,sans-serif;color:#17150f;background:#faf8f2;line-height:1.65;margin:0}
.wrap{max-width:860px;margin:0 auto;padding:36px 22px 60px}
h1{font-size:clamp(26px,4.5vw,40px);line-height:1.15;margin:8px 0 12px}
h2{font-size:21px;margin:30px 0 8px;border-bottom:1px solid #e3e0d4;padding-bottom:5px}
h3{font-size:16px;margin:20px 0 6px}
code{background:#efece1;padding:1px 6px;border-radius:5px;font-size:.92em}
pre{background:#17150f;color:#f5f2e8;padding:14px;border-radius:10px;overflow:auto;font-size:13px}
pre code{background:none;padding:0;color:inherit}
.tag{display:inline-block;background:#ff5e00;color:#fff;font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;padding:5px 12px;border-radius:50px}
a{color:#ff5e00}
.meta{color:#6b675c;font-size:14px}
li{margin:3px 0}
table{border-collapse:collapse;width:100%;font-size:14.5px;margin:12px 0}
th,td{border:1px solid #e3e0d4;padding:8px 11px;text-align:left;vertical-align:top}
th{background:#f1eee4}`;

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// markdown mínimo → HTML (headers, bold, code, listas, links)
function md2html(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let inList = false, inCode = false;
  const inline = (t) => esc(t)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  for (const raw of lines) {
    if (raw.trim().startsWith("```")) { inCode = !inCode; out.push(inCode ? "<pre><code>" : "</code></pre>"); continue; }
    if (inCode) { out.push(esc(raw)); continue; }
    const t = raw.trim();
    if (!t) { if (inList) { out.push("</ul>"); inList = false; } continue; }
    if (t.startsWith("- ")) { if (!inList) { out.push("<ul>"); inList = true; } out.push(`<li>${inline(t.slice(2))}</li>`); continue; }
    if (inList) { out.push("</ul>"); inList = false; }
    const h = t.match(/^(#{1,3})\s+(.*)/);
    if (h) { const n = h[1].length; out.push(`<h${n}>${inline(h[2])}</h${n}>`); continue; }
    out.push(`<p>${inline(t)}</p>`);
  }
  if (inList) out.push("</ul>");
  return out.join("\n");
}

const TODAY = new Date().toISOString().slice(0, 10);
const pages = [];

if (!existsSync(SKILLS)) { console.log("no .agents/skills, skip"); process.exit(0); }
const { readdirSync } = await import("node:fs");
for (const dir of readdirSync(SKILLS).sort()) {
  const f = join(SKILLS, dir, "SKILL.md");
  if (!existsSync(f)) continue;
  const raw = readFileSync(f, "utf-8");
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!fm) continue;
  const meta = Object.fromEntries(fm[1].split(/\r?\n/).map((l) => l.match(/^(\w+):\s*(.*)$/)?.slice(1, 3) || []).filter(Boolean));
  const name = meta.name || dir;
  const desc = meta.description || "";
  const bodyEs = fm[2];
  const titleEs = (bodyEs.match(/^#\s+(.+)$/m) || [])[1] || name;

  const page = (lang) => {
    const isEn = lang === "en";
    // EN: misma página con aviso (las skills fuente están en español; los ids de
    // herramientas son el idioma universal — la API responde igual).
    const body = isEn
      ? bodyEs.replace(/^(#\s+.+)$/m, "$1")
      : bodyEs;
    const t = isEn
      ? { tag: "Agent docs", h1: titleEs, lead: `${desc} — official agent documentation for Musa's MCP server. Tool names are the API surface; guides are written in Spanish, the product's working language.`, cta: "Connect your agent →" }
      : { tag: "Docs de agentes", h1: titleEs, lead: desc, cta: "Conecta tu agente →" };
    return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titleEs)} — Musa ${isEn ? "Agent Docs" : "Docs"}</title>
<meta name="description" content="${esc((isEn ? desc + " — Musa MCP agent documentation." : desc).slice(0, 300))}">
<link rel="canonical" href="${SITE}/docs/${name}/">
<link rel="alternate" hreflang="en" href="${SITE}/en/docs/${name}/">
<link rel="alternate" hreflang="es" href="${SITE}/docs/${name}/">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"TechArticle","name":${JSON.stringify(titleEs)},"description":${JSON.stringify(desc.slice(0, 300))},"url":"${SITE}/docs/${name}/","isPartOf":{"@type":"WebSite","name":"Musa by Futuraria","url":"${SITE}"},"inLanguage":"${lang}"}</script>
<style>${CSS}</style>
</head>
<body><div class="wrap">
  <span class="tag">${t.tag}</span>
  <h1>${esc(titleEs)}</h1>
  <p class="meta"><a href="/docs/">${isEn ? "← All modules" : "← Todos los módulos"}</a> · <a href="/guides/connect-agent-mcp/">${t.cta}</a></p>
  ${md2html(body)}
  <p class="meta">${isEn ? "Musaworks agent documentation · updated" : "Documentación de agentes de Musaworks · actualizado"} ${TODAY}</p>
</div></body></html>`;
  };

  mkdirSync(join(DIST, "docs", name), { recursive: true });
  writeFileSync(join(DIST, "docs", name, "index.html"), page("es"));
  pages.push({ name, title: titleEs, desc });
}

// index /docs/ — tabla de los 21 módulos
const indexPage = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Docs de agentes — Musa by Futuraria</title>
<meta name="description" content="Documentación técnica oficial de los módulos de Musa para agentes de IA: diseño, video, calendario, CRM, ads, bandeja y más. La misma guía que leen los agentes vía MCP, pública y crawlable.">
<link rel="canonical" href="${SITE}/docs/">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"CollectionPage","name":"Musa agent documentation","url":"${SITE}/docs/","hasPart":[${pages.map((p) => `{"@type":"TechArticle","name":${JSON.stringify(p.title)},"url":"${SITE}/docs/${p.name}/"}`).join(",")}]}</script>
<style>${CSS}</style>
</head>
<body><div class="wrap">
  <span class="tag">Docs de agentes</span>
  <h1>La documentación que leen los agentes de IA, ahora pública</h1>
  <p class="lead">Estas son las mismas guías que carga un agente cuando opera Musa vía MCP (${pages.length} módulos). Las publicamos completas y sin registro: si quieres evaluar si Musa sirve para tu agente, o enseñarle a uno nuevo, aquí está todo — diseño, video, calendario, bandeja, pauta, CRM, reportes y más.</p>
  <table><thead><tr><th>Módulo</th><th>Qué cubre</th></tr></thead><tbody>
${pages.map((p) => `    <tr><td><a href="/docs/${p.name}/"><strong>${esc(p.title)}</strong></a></td><td>${esc(p.desc.slice(0, 160))}</td></tr>`).join("\n")}
  </tbody></table>
  <p><a href="/guides/connect-agent-mcp/">Guía de conexión MCP →</a> · <a href="/insights/">Números reales de producción →</a> · <a href="/llms.txt">llms.txt</a></p>
</div></body></html>`;
writeFileSync(join(DIST, "docs", "index.html"), indexPage);

// parche al sitemap del dist (el geo build ya corrió; añadimos /docs/ + módulos)
try {
  const sp = join(DIST, "sitemap.xml");
  let xml = readFileSync(sp, "utf-8");
  const add = (loc, pri) => { if (!xml.includes(loc)) xml = xml.replace("</urlset>", `  <url><loc>${loc}</loc><lastmod>${TODAY}</lastmod><changefreq>weekly</changefreq><priority>${pri}</priority></url>\n</urlset>`); };
  add(`${SITE}/docs/`, "0.8");
  for (const p of pages) add(`${SITE}/docs/${p.name}/`, "0.6");
  writeFileSync(sp, xml);
  // también al public (fuente)
  try { writeFileSync(join(ROOT, "public", "sitemap.xml"), xml); } catch {}
  console.log(`sitemap: +${pages.length + 1} URLs docs`);
} catch (e) { console.log("sitemap patch skip:", String(e).slice(0, 80)); }

console.log(`OK docs: ${pages.length} módulos + index en dist/docs/ (${pages.reduce((a, p) => a + 1, 0) + 1} páginas)`);
