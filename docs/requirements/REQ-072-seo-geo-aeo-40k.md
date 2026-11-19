# REQ-072 — SEO/GEO/AEO musaworks.com → 40K visitas IA/mes

**Fecha:** 2026-11-18 · **Dueño:** Hermes · **Estado:** plan aprobado en investigación, ejecución por fases
**Meta:** 40,000 vistas mensuales desde motores de IA (baseline FuturariaWeb: 20K/mes). Prioridad 1: GEO/AEO al 100%.

## Diagnóstico (verificado con fetches reales, 18-nov-2026)

### Lo que YA está fuerte (no rehacer)
- robots.txt pro-IA: GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot/User/SearchBot, PerplexityBot/User, Google-Extended, Applebot-Extended, CCBot, Bytespider, Amazonbot, Diffbot, YouBot, Meta-ExternalAgent — Allow /.
- llms.txt completo con pricing (símbolos $ en texto), comparativas, FAQ, entry points MCP — PERO stale: "Last updated 2026-09-09", dice "alpha / curated email application" (ya es self-serve con Creem).
- /compare/ y /comparar/: estáticas crawlables (12.8K chars para GPTBot), 16 herramientas × 2 idiomas — el formato exacto que ChatGPT cita en "best X for Y".
- /agents/: estática crawlable (5.3K chars).
- Agent readiness único en su categoría: POST /mcp, .well-known/mcp.json, skills catalog (musa-tools.json).
- JSON-LD en root: Organization (sameAs solo github.com/reno42/design), WebApplication, JobPosting. Canonical dinámico EN/ES por geo + hreflang (worker/i18n-root.mjs).
- Redirect canónico workers.dev→musaworks.com (commit f848014, mismo día).

### Lo que bloquea TODO (en orden de gravedad)
1. **El landing raíz es INVISIBLE para crawlers IA.** `<div id="root">` vacío; GPTBot ve 82 caracteres (solo el title), 0 H1, 0 texto, 0 precios. La web es React client-side y los bots no ejecutan JS. Falla documentada como "JavaScript pricing failure mode": el modelo busca `$` y números en el HTML servido, no los encuentra, y cita a G2 o a la competencia en su lugar (cadena de razonamiento capturada de ChatGPT en análisis de tráfico jun-2026).
2. **GA4 NO está instalado en musaworks.com** (0 hits de gtag en el HTML y el bundle). Sin baseline no se puede medir el objetivo ni validar nada.
3. **llms.txt miente al ecosistema de agentes**: dice alpha/curated cuando hoy hay signup self-serve y pricing Creem. Los agentes LEEN esto y lo repiten (es de las fuentes más parseadas).
4. **ai.txt y llms-full.txt son fantasmas**: 200 con el HTML de la SPA (fallback), no el archivo. 200-fantasma confunde a parsers; peor que un 404.
5. **Huella externa ~cero**: 1 sola mención indexada de "Musa by Futuraria" (LinkedIn Maritime YC26 / hackathon UNI con Replit). El off-site es ~30-40% del juego de citas (KDD 2024; Ahrefs 2026: brand mentions = señal #1).
6. **Ambigüedad de entidad**: "musaworks" choca con Musa Works (interiorismo, Essex UK, con email @musaworks.com!), musawork.com (blog spam), Atelier Musa (anime, Japón), Museworks. Sin desambiguación, los modelos pueden atribuir el dominio al interiorista.

### Datos de plataforma (grounded en super-geo-agent-readiness + Cited guide)
- ChatGPT = 85.8% del tráfico IA de referencia; su índice es BING. 90% de sus citas son URLs que rank 21+ en Google (Bing las sí tiene). → **Bing Webmaster Tools es el vector #1**.
- Perplexity: 91% overlap con Google top-10, heavy schema consumer.
- AI Overviews de Google: GEO = SEO clásico (llms.txt ignorado por Google Search); FAQPage schema es high-leverage.
- Formatos que ganan citas: original research, case studies con nombre+numeros, comparativas con tablas, FAQ (1 pregunta/H3, <100 palabras), HowTo, guías 2000+ palabras.
- El modelo de pensamiento de ChatGPT dispara `site:dominio/pricing` y grepea el HTML crudo.

## FASE 0 — Medir (día 1)
1. GA4 en musaworks.com: inyectar gtag server-side en worker/i18n-root.mjs (mismo mecanismo que canonical/hreflang), property nueva para Musa. Configurar canal custom "AI Referrals" con regex: `.*(chatgpt\.com|openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com|grok\.x\.ai|x\.com/grok|meta\.ai|deepseek\.com|you\.com|search\.brave\.com|kagi\.com).*` encima del canal Referral.
2. Bing Webmaster Tools: verificar (meta o XML), IMPORTAR desde GSC, submit /sitemap.xml. (GSC ya verificado y sitemap enviado el 15-nov.)
3. Baseline de 7 días antes de juzgar cualquier cambio.

## FASE 1 — Ser legible por bots (semana 1) — LA reparación central
1. **Pre-render estático del landing en build**: componente `LandingStatic` (server-safe, sin hooks de estado) renderizado con react-dom/server en build time e inyectado dentro de `<div id="root">` de dist/index.html por un plugin post-build. React (createRoot) REEMPLAZA el contenido al montar — cero riesgo de hydration mismatch. Debe incluir: H1 + tagline, 3-4 features (texto), TABLA DE PRECIOS con $ en HTML (regla de oro: sobrevivir `site:musaworks.com/pricing`), 8 FAQ visibles, links a /compare/, /comparar/, /agents/, /llms.txt.
2. **FAQPage JSON-LD** espejo exacto del FAQ visible (AI Overviews cita FAQ schema; Perplexity consume schema).
3. **llms.txt refresh**: alpha→self-serve, pricing vigente, fecha nueva, sección Docs (/docs/mapa_musa, musa_negocio, musa_promo, diagrama_ciclo_contenido) y /compare/. Regla: actualizarlo en cada cambio de pricing (agregarlo al checklist de deploy).
4. **ai.txt y llms-full.txt REALES** (o quitarlos): generados del contenido real, llms-full ≤200KB. 200-fantasma prohibido.
5. **Desambiguación de entidad**: Organization.sameAs ampliado (LinkedIn Futuraria, X, YouTube si hay), `disambiguatingDescription` ("Musa is an AI content platform by Peruvian company Futuraria, not Musa Works the Essex interior design firm"), nombre consistente "Musa by Futuraria" en title/og/site_name.
6. Sitemap: verificar que /compare/, /comparar/ y futuras /faq, /guides están (44 URLs hoy).

## FASE 2 — Contenido citable (semanas 2-5)
Formatos con mayor tasa de cita (Semrush/KDD), en este orden:
1. **HowTo estática**: "How to connect an AI agent to a design platform via MCP (Musa example)" — HowTo schema, pasos numerados, EN+ES. Objetivo: LA query "design tool for AI agents / MCP design automation".
2. **/faq estática** con FAQPage schema (20-30 preguntas reales del producto, 1 pregunta por H3, respuestas <100 palabras).
3. **Case study**: hackathon UNI + Replit + Musa (ya pasó, tiene nombre real) — números de piezas producidas, quotes.
4. **Original research**: métrica única de la plataforma (piezas/semana generadas por agentes, distribución de formatos) — dato que nadie más tiene = citable.
5. **Glosario** (3-5 páginas): "what is agentic design", "what is MCP", "AI content operations" — queries "what is X".
6. Ampliar comparativas: agregar las que falten del top de búsquedas IA (DesignRR, Simplified, VistaCreate, Gamma...).

## FASE 3 — Off-site (continuo, semanas 2-12)
1. GitHub reno42/design README → links a musaworks.com (GitHub es corpus de training directo y da backlink fuerte).
2. Reddit (audiencia natural de Ren): showcase honesto en r/AI_Agents, r/SideProject, r/n8n — el ángulo "mi plataforma de diseño se opera por MCP" es único. Comentar hilos de "best AI design tool" sin spam (1 link en perfil).
3. Pedir mención con link al post del hackathon UNI/Maritime (ya nos citan sin link).
4. Show HN en el próximo hito medible. Product Hunt si hay launch.
5. YouTube/GitHub y directorios de servidores MCP (mcp.so, Smithery, PulseMCP — registrar el MCP de Musa; son los catálogos que los agentes consultan).

## KPIs
| Métrica | Fuente | Frecuencia |
|---|---|---|
| Vistas desde AI Referrals | GA4 canal custom | semanal |
| Impresiones AI Overviews | GSC Performance | semanal |
| Indexación Bing de /compare/ + pricing | BWT | semanal |
| Citas en ChatGPT/Perplexity ("best MCP design tool", "Musa by Futuraria") | probe manual semanal con prompts fijos | semanal |
| site:musaworks.com/pricing probe | curl | post-cambios |

## Fuera de alcance (esta REQ)
- SSR completo de la app (React SPA → framework con SSR) = proyecto mayor separado.
- Blog/CMS (los websites de Musa podrían servirlo, pero es decisión de producto).
- Compra de links/prensa pagada.

## Criterios de aceptación
- [ ] GPTBot/ClaudeBot/PerplexityBot ven >2,000 chars de texto con H1, precios $ y FAQ en el HTML crudo de /.
- [ ] GA4 registra la primera sesión de chatgpt.com/referral en ≤7 días post-instalación.
- [ ] Bing indexa /compare/ (query site:musaworks.com/compare en Bing devuelve resultados).
- [ ] llms.txt fecha nueva + sin claims alpha; llms-full.txt y ai.txt reales o ausentes (nunca 200-fantasma).
- [ ] Probe semanal: ChatGPT nombra a Musa en ≥1 de 3 prompts de categoría para semana 8.

## Referencias usadas
- repos/geo-research/super-geo-agent-readiness (SKILL + references: platforms, technical, content-strategy, measurement)
- repos/geo-research/Cited-io/generative-engine-optimization-guide (14 capítulos, datos oct-2026)
- repos/geo-research/vespid-ai/geo-skill (auditor CLI)
- KDD 2024 GEO paper (arxiv 2311.09735)
