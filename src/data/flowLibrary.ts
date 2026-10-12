// REQ-027 — Biblioteca de flows: presets listos para clonar al workspace.
// ES el formato exportable (mismo JSON que flow_export): sin workspaceId ni
// credenciales — los nodos ai/template quedan "a configurar" (credentialId
// null, templateId/frameId vacíos) y el humano o su IA los completa después
// (picker del editor / flow_save).
//
// Flows-brand: los presets con RECETA viva (config.recipe en el nodo template)
// llegan VIVOS — el frame viaja en la definición con tokens {{token}} que la
// IA viste (extraValues/inputs); el humano reemplaza la receta por SU
// templateId+frameId cuando diseña la pieza propia. Como las recetas de copy,
// pero con diseños.
//
// Este módulo es PURO (cero React): lo importa la UI (Biblioteca) y el server
// (flow_library_list / flow_library_instantiate en netlify/functions/mcp.mjs)
// — una sola fuente de verdad, cero drift.

import type { FlowInputField } from "../components/flows/flowTypes";

export interface FlowPresetNode {
  id: string;
  type: string;
  label: string;
  enabled?: boolean;
  onError?: "stop" | "continue";
  config: Record<string, unknown>;
  position: { x: number; y: number };
}

export interface FlowPresetEdge {
  from: string;
  to: string;
  when?: "true" | "false";
}

export interface FlowPreset {
  id: string;
  name: string;
  description: string;
    // entry/position: línea disparo→nodo del editor (solo UI, organizativa —
    // validateTrigger la persiste; el run sigue empezando en los nodos fuente).
    trigger: { type: "manual" | "webhook" | "schedule"; cron?: string; timezone?: string; entry?: string; position?: { x: number; y: number } } | null;
  nodes: FlowPresetNode[];
  edges: FlowPresetEdge[];
  /** Flows-brand: inputs declarados — el run los pide en el mini-form (UI) o
   *  en el payload (IA/webhook); executeFlow aplica defaults y required. */
  inputs?: FlowInputField[];
}

const REDACTAR_ES = "Eres editor de noticias. Recibes una noticia (título y resumen en su idioma original). Devuelve SOLO un resumen en español neutro, 2 frases máximo (280 caracteres), sin comillas ni prefijos. Tono informativo, sin clickbait.";

// Recetas de DEMO compartidas: piezas estáticas que prueban el flow de una
// (instala → ▶ Ejecutar y ves la pieza). El humano las reemplaza por SUS
// frames después (editor → nodo template → templateId+frameId).
const demoPostRecipe = (tag: string, acento = "#7dd3fc") => ({
  width: 1080, height: 1350, background: "#101014",
  html: `<main>\n  <span class="kicker">${tag}</span>\n  <h1>Así se ve tu contenido</h1>\n  <p class="cuerpo">Pieza generada por el flow con su receta viva de demo. Reemplázala por tus propios frames cuando diseñes la pieza final.</p>\n  <div class="chip">Receta demo</div>\n</main>`,
  css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;gap:40px;padding:88px;background:radial-gradient(120% 100% at 50% 0%,#1a2233 0%,#101014 60%);color:#f5f5f7;font-family:Georgia,serif}.kicker{font-size:24px;letter-spacing:6px;text-transform:uppercase;color:${acento}}h1{font-size:96px;line-height:1.06}.cuerpo{font-size:36px;line-height:1.55;color:rgba(245,245,247,.8);max-width:880px}.chip{justify-self:start;font-size:28px;font-weight:700;color:#101014;background:${acento};border-radius:999px;padding:18px 48px}`,
});
const demoStoryRecipe = (tag: string, acento = "#7dd3fc") => ({
  width: 1080, height: 1920, background: "#101014",
  html: `<main>\n  <span class="kicker">${tag}</span>\n  <h1>Guarda esta historia</h1>\n  <p class="cuerpo">Story de demo del flow — así queda tu contenido en 9:16.</p>\n  <div class="chip">Receta demo</div>\n</main>`,
  css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;justify-items:center;gap:48px;padding:110px 90px;text-align:center;background:radial-gradient(120% 80% at 50% 0%,#1a2233 0%,#101014 60%);color:#f5f5f7;font-family:Georgia,serif}.kicker{font-size:26px;letter-spacing:8px;text-transform:uppercase;color:${acento}}h1{font-size:140px;line-height:1.06}.cuerpo{font-size:40px;line-height:1.5;color:rgba(245,245,247,.8);max-width:840px}.chip{font-size:30px;font-weight:700;color:#101014;background:${acento};border-radius:999px;padding:20px 56px}`,
});

export const FLOW_LIBRARY: FlowPreset[] = [
  {
    id: "preset_noticias",
    name: "Noticias (RSS → carrusel)",
    description: "La bandera: 2 feeds RSS + IA que redacta en español + pieza post y story de DEMO (receta viva — reemplázalas por tus frames) + reporte.",
    trigger: { type: "schedule", cron: "0 8 * * *", timezone: "America/Lima" },
    nodes: [
      { id: "rss1", type: "source_rss", label: "BBC Mundo", config: { url: "https://feeds.bbci.co.uk/mundo/rss.xml", limit: 10 }, position: { x: 40, y: 40 } },
      { id: "rss2", type: "source_rss", label: "DW Español", config: { url: "https://rss.dw.com/rdf/rss-sp-top", limit: 10 }, position: { x: 40, y: 200 } },
      { id: "ai1", type: "ai", label: "Redactor ES", config: { provider: "openrouter", model: "", credentialId: null, systemPrompt: REDACTAR_ES, prompt: "Noticia: {{item.title}} — {{item.summary}}", maxOutputTokens: 400, maxItems: 3 }, position: { x: 360, y: 120 } },
      { id: "post1", type: "template", label: "Post demo (receta)", config: { format: "post", maxItems: 3, recipe: demoPostRecipe("Noticias · post") }, position: { x: 700, y: 40 } },
      { id: "story1", type: "template", label: "Story demo (receta)", config: { format: "story", maxItems: 3, recipe: demoStoryRecipe("Noticias · story") }, position: { x: 700, y: 220 } },
      { id: "rep1", type: "report", label: "Reporte", config: { title: "Edición diaria" }, position: { x: 1020, y: 120 } },
    ],
    edges: [
      { from: "rss1", to: "ai1" }, { from: "rss2", to: "ai1" },
      { from: "ai1", to: "post1" }, { from: "ai1", to: "story1" },
      { from: "post1", to: "rep1" }, { from: "story1", to: "rep1" },
    ],
  },
  {
    id: "preset_noticias_tech_en",
    name: "Noticias tech EN → traducidas",
    description: "Feeds en inglés (TechCrunch + The Verge) → IA traduce y resume al español → carrusel con pieza de demo (receta viva — luego tus frames).",
    trigger: { type: "schedule", cron: "30 9 * * *", timezone: "America/Lima" },
    nodes: [
      { id: "rss1", type: "source_rss", label: "TechCrunch", config: { url: "https://techcrunch.com/feed/", limit: 10 }, position: { x: 40, y: 40 } },
      { id: "rss2", type: "source_rss", label: "The Verge", config: { url: "https://www.theverge.com/rss/index.xml", limit: 10 }, position: { x: 40, y: 200 } },
      { id: "ai1", type: "ai", label: "Traductor ES", config: { provider: "openrouter", model: "", credentialId: null, systemPrompt: "Traduce al español neutro y resume en 2 frases (máx 280 caracteres). Devuelve SOLO el resumen.", prompt: "Noticia: {{item.title}} — {{item.summary}}", maxOutputTokens: 400, maxItems: 3 }, position: { x: 360, y: 120 } },
      { id: "post1", type: "template", label: "Post demo (receta)", config: { format: "post", maxItems: 3, recipe: demoPostRecipe("Tech EN → ES") }, position: { x: 700, y: 120 } },
      { id: "rep1", type: "report", label: "Reporte", config: { title: "Tech EN→ES" }, position: { x: 1020, y: 120 } },
    ],
    edges: [
      { from: "rss1", to: "ai1" }, { from: "rss2", to: "ai1" },
      { from: "ai1", to: "post1" }, { from: "post1", to: "rep1" },
    ],
  },
  {
    id: "preset_vigilancia",
    name: "Vigilancia de competencia",
    description: "RSS + cuentas de X de la competencia → IA hace digest ejecutivo → documento resumen (sin carrusel).",
    trigger: { type: "schedule", cron: "0 7 * * 1", timezone: "America/Lima" },
    nodes: [
      { id: "rss1", type: "source_rss", label: "Blog del rubro", config: { url: "https://feeds.bbci.co.uk/news/business/rss.xml", limit: 10 }, position: { x: 40, y: 40 } },
      { id: "x1", type: "source_nitter", label: "X competencia", config: { username: "competencia", instanceUrl: "https://nitter.net", limit: 15 }, position: { x: 40, y: 200 } },
      { id: "ai1", type: "ai", label: "Digest semanal", config: { provider: "openrouter", model: "", credentialId: null, systemPrompt: "Eres analista competitivo. Con las noticias y posts, escribe un digest ejecutivo de máximo 8 líneas: qué hizo la competencia, qué implica para nosotros.", prompt: "Entradas: {{steps.rss1.items}} y {{steps.x1.items}}", maxOutputTokens: 700 }, position: { x: 360, y: 120 } },
      { id: "rep1", type: "report", label: "Reporte", config: { title: "Digest competencia" }, position: { x: 700, y: 120 } },
    ],
    edges: [
      { from: "rss1", to: "ai1" }, { from: "x1", to: "ai1" }, { from: "ai1", to: "rep1" },
    ],
  },
  {
    id: "preset_chisme_x",
    name: "Chisme de X → hot takes",
    description: "Cuenta de X vía Nitter → IA convierte en takes de opinión con tu voz → frame post de demo (receta viva).",
    trigger: { type: "manual" },
    nodes: [
      { id: "x1", type: "source_nitter", label: "Cuenta X", config: { username: "usuario", instanceUrl: "https://nitter.net", limit: 10 }, position: { x: 40, y: 120 } },
      { id: "ai1", type: "ai", label: "Hot take", config: { provider: "openrouter", model: "", credentialId: null, systemPrompt: "Convierte la noticia en un take de opinión corto, directo y con personalidad (máx 220 caracteres). Sin hashtags.", prompt: "Post: {{item.title}} — {{item.summary}}", maxOutputTokens: 300, maxItems: 3 }, position: { x: 360, y: 120 } },
      { id: "post1", type: "template", label: "Post demo (receta)", config: { format: "post", maxItems: 3, recipe: demoPostRecipe("Hot takes · X", "#f472b6") }, position: { x: 700, y: 120 } },
    ],
    edges: [ { from: "x1", to: "ai1" }, { from: "ai1", to: "post1" } ],
  },
  {
    id: "preset_monitor_precio",
    name: "Monitor de precio/API",
    description: "Consulta una API JSON, compara contra un umbral y avisa (POST a tu webhook) solo cuando se pasa. Demo real: vigila el tipo de cambio USD→PEN (Frankfurter, gratis y sin key).",
    trigger: { type: "schedule", cron: "*/30 * * * *", timezone: "America/Lima" },
    nodes: [
      { id: "src1", type: "source_http", label: "API demo: USD→PEN", config: { url: "https://api.frankfurter.app/latest?from=USD&to=PEN", limit: 5 }, position: { x: 40, y: 120 } },
      { id: "cond1", type: "condition", label: "¿Bajó de 4?", config: { path: "item.rates.PEN", operator: "less_than", value: 4 }, position: { x: 360, y: 120 } },
      { id: "hook1", type: "http", label: "Avisar webhook", config: { url: "https://jsonplaceholder.typicode.com/posts", method: "POST", body: { text: "USD/PEN por debajo de 4: {{item.rates.PEN}}" } }, position: { x: 700, y: 40 } },
      { id: "rep1", type: "report", label: "Reporte", config: { title: "Monitor" }, position: { x: 700, y: 220 } },
    ],
    edges: [
      { from: "src1", to: "cond1" },
      { from: "cond1", to: "hook1", when: "true" },
      { from: "cond1", to: "rep1", when: "false" },
      { from: "hook1", to: "rep1" },
    ],
  },
  {
    id: "preset_seo_geo",
    name: "SEO/Geo: variantes de post",
    description: "Una keyword → IA genera título y descripción SEO → 2 variantes de post de demo (receta viva — luego tus frames).",
    trigger: { type: "manual" },
    nodes: [
      { id: "map1", type: "map", label: "Keyword", config: { value: { keyword: "cursos de diseño lima", ciudad: "Lima" } }, position: { x: 40, y: 120 } },
      { id: "ai1", type: "ai", label: "Copy SEO", config: { provider: "openrouter", model: "", credentialId: null, systemPrompt: "Eres especialista SEO local. Dado keyword y ciudad, devuelve: un título (máx 60 caracteres) y una descripción (máx 155 caracteres). Formato: TITULO: ... | DESCRIPCION: ...", prompt: "Keyword: {{steps.map1.keyword}} — Ciudad: {{steps.map1.ciudad}}", maxOutputTokens: 300 }, position: { x: 360, y: 120 } },
      { id: "post1", type: "template", label: "Variante A (receta)", config: { format: "post", maxItems: 1, recipe: demoPostRecipe("SEO · variante A", "#4ade80") }, position: { x: 700, y: 40 } },
      { id: "post2", type: "template", label: "Variante B (receta)", config: { format: "post", maxItems: 1, recipe: demoPostRecipe("SEO · variante B", "#fbbf24") }, position: { x: 700, y: 200 } },
    ],
    edges: [ { from: "map1", to: "ai1" }, { from: "ai1", to: "post1" }, { from: "ai1", to: "post2" } ],
  },
  {
    id: "preset_testimonio",
    name: "Testimonio → card quote",
    description: "Pega un testimonio (map) → una card quote de DEMO lo convierte en pieza lista para publicar (los tokens {{title}}/{{summary}} ya van cableados; luego reemplaza la receta por tu frame).",
    trigger: { type: "manual" },
    nodes: [
      { id: "map1", type: "map", label: "Testimonio", config: { value: { title: "Cliente feliz", summary: "Musa nos ahorró 10 horas semanales de diseño.", source: "Ana P., Marketing Lead" } }, position: { x: 40, y: 120 } },
      { id: "post1", type: "template", label: "Card quote (receta)", config: { format: "post", maxItems: 1, recipe: { width: 1080, height: 1350, background: "#101014", html: `<main>\n  <span class="kicker">Testimonio</span>\n  <blockquote>“{{summary}}”</blockquote>\n  <div class="autor">{{source}}</div>\n  <footer>{{title}}</footer>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;gap:44px;padding:90px;background:radial-gradient(120% 100% at 50% 0%,#241522 0%,#101014 62%);color:#f5f5f7;font-family:Georgia,serif}.kicker{font-size:24px;letter-spacing:6px;text-transform:uppercase;color:#f472b6}blockquote{font-size:76px;line-height:1.2;max-width:900px}.autor{font-size:38px;font-weight:700;color:#f472b6}footer{font-size:28px;color:rgba(245,245,247,.55)}` } }, position: { x: 360, y: 120 } },
    ],
    edges: [ { from: "map1", to: "post1" } ],
  },
  {
    id: "preset_calendario",
    name: "Calendario: evento → recordatorio",
    description: "Lee una API JSON y crea un post recordatorio por entrada. Demo con API pública real (posts de ejemplo); apunta la fuente a TU agenda al activar.",
    trigger: { type: "schedule", cron: "0 6 * * *", timezone: "America/Lima" },
    nodes: [
      { id: "src1", type: "source_http", label: "API demo (posts)", config: { url: "https://jsonplaceholder.typicode.com/posts?_limit=3", limit: 5 }, position: { x: 40, y: 120 } },
      { id: "post1", type: "template", label: "Post recordatorio (receta)", config: { format: "post", maxItems: 3, recipe: { width: 1080, height: 1350, background: "#101014", html: `<main>\n  <span class="kicker">Recordatorio</span>\n  <h1>{{title}}</h1>\n  <p class="cuerpo">Entrada de la agenda de demo — al activar, apunta la fuente a TU API y esta misma pieza sale con tus eventos.</p>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;gap:40px;padding:88px;background:radial-gradient(120% 100% at 50% 0%,#1c2a1e 0%,#101014 60%);color:#f5fff0;font-family:Georgia,serif}.kicker{font-size:24px;letter-spacing:6px;text-transform:uppercase;color:#b7f26d}h1{font-size:92px;line-height:1.06;max-width:880px}.cuerpo{font-size:36px;line-height:1.55;color:rgba(245,255,240,.8);max-width:860px}` } }, position: { x: 360, y: 120 } },
      { id: "rep1", type: "report", label: "Reporte", config: { title: "Recordatorios" }, position: { x: 700, y: 120 } },
    ],
    edges: [ { from: "src1", to: "post1" }, { from: "post1", to: "rep1" } ],
  },
  {
    id: "preset_newsletter",
    name: "Newsletter: digest de N feeds",
    description: "3 feeds → IA escribe un digest largo estilo newsletter → documento de demo (receta viva) + reporte.",
    trigger: { type: "schedule", cron: "0 6 * * 5", timezone: "America/Lima" },
    nodes: [
      { id: "rss1", type: "source_rss", label: "Feed 1", config: { url: "https://feeds.bbci.co.uk/mundo/rss.xml", limit: 8 }, position: { x: 40, y: 40 } },
      { id: "rss2", type: "source_rss", label: "Feed 2", config: { url: "https://rss.dw.com/rdf/rss-sp-top", limit: 8 }, position: { x: 40, y: 180 } },
      { id: "rss3", type: "source_rss", label: "Feed 3", config: { url: "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada", limit: 8 }, position: { x: 40, y: 320 } },
      { id: "ai1", type: "ai", label: "Redactor newsletter", config: { provider: "openrouter", model: "", credentialId: null, systemPrompt: "Eres editor de newsletter. Con las noticias, escribe un digest de 5 bloques cortos con subtítulos. Tono cercano, frases cortas.", prompt: "Noticias de esta semana: {{steps.rss1.items}} {{steps.rss2.items}} {{steps.rss3.items}}", maxOutputTokens: 1_500 }, position: { x: 360, y: 180 } },
      { id: "doc1", type: "template", label: "Documento (receta)", config: { format: "custom", maxItems: 1, recipe: { width: 820, height: 1160, background: "#ffffff", html: `<main>\n  <span class="kicker">Newsletter semanal</span>\n  <h1>Digest de la semana</h1>\n  <p class="cuerpo">Aquí va el digest que redactó la IA: 5 bloques cortos con subtítulos, listo para pegar en tu herramienta de envíos.</p>\n  <div class="firma">Documento de demo — receta viva</div>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;gap:38px;padding:72px;background:#ffffff;color:#14141c;font-family:Georgia,serif}.kicker{font-size:20px;letter-spacing:5px;text-transform:uppercase;color:#7c3aed}h1{font-size:58px;line-height:1.1}.cuerpo{font-size:28px;line-height:1.6;color:#333;max-width:640px}.firma{font-size:22px;color:#999;border-top:2px solid #eee;padding-top:20px}` } }, position: { x: 700, y: 180 } },
      { id: "rep1", type: "report", label: "Reporte", config: { title: "Newsletter" }, position: { x: 1020, y: 180 } },
    ],
    edges: [
      { from: "rss1", to: "ai1" }, { from: "rss2", to: "ai1" }, { from: "rss3", to: "ai1" },
      { from: "ai1", to: "doc1" }, { from: "doc1", to: "rep1" },
    ],
  },
  // ── Flows-brand: presets con RECETA viva (llegan corriendo) ──
  {
    id: "preset_manual_marca",
    name: "Manual de marca express (receta viva)",
    description: "Investiga el rubro en la web (webSearch del proveedor), define paleta + tipografías + eslogan en JSON y viste una CARD de manual de marca. Sin plantilla previa; reemplaza la receta por tu pieza cuando quieras.",
    trigger: { type: "manual" },
    inputs: [
      { key: "marca", label: "Marca", type: "text", required: true, default: "Café Borja" },
      { key: "rubro", label: "Rubro / categoría", type: "text", required: false, default: "cafetería de especialidad" },
      { key: "publico", label: "Público objetivo", type: "text", required: false, default: "jóvenes profesionales de Lima" },
    ],
    nodes: [
      { id: "map1", type: "map", label: "Brief", config: { value: { marca: "{{input.marca}}", rubro: "{{input.rubro}}", publico: "{{input.publico}}" } }, position: { x: 40, y: 120 } },
      { id: "ai1", type: "ai", label: "Investiga y define", config: { provider: "openrouter", model: "", credentialId: null, webSearch: true, responseFormat: "json", systemPrompt: "Eres director de arte. Con el brief, investiga referencias reales del rubro y define una identidad PODEROSA y distinta. Responde SOLO JSON con: colorPrimario, colorAcento y colorFondo en hex (#rrggbb), tipografiaTitulos y tipografiaTexto (parejas Google Fonts reales), eslogan (máx 8 palabras, español).", prompt: "Marca: {{steps.map1.marca}}\nRubro: {{steps.map1.rubro}}\nPúblico: {{steps.map1.publico}}", maxOutputTokens: 700, schema: { type: "object", required: ["colorPrimario", "colorAcento", "colorFondo", "tipografiaTitulos", "tipografiaTexto", "eslogan"], properties: { colorPrimario: { type: "string" }, colorAcento: { type: "string" }, colorFondo: { type: "string" }, tipografiaTitulos: { type: "string" }, tipografiaTexto: { type: "string" }, eslogan: { type: "string" } } } }, position: { x: 360, y: 120 } },
      { id: "map2", type: "map", label: "Tokens de marca", config: { value: { marca: "{{input.marca}}", rubro: "{{input.rubro}}", publico: "{{input.publico}}", colorPrimario: "{{steps.ai1.json.colorPrimario}}", colorAcento: "{{steps.ai1.json.colorAcento}}", colorFondo: "{{steps.ai1.json.colorFondo}}", tipografiaTitulos: "{{steps.ai1.json.tipografiaTitulos}}", tipografiaTexto: "{{steps.ai1.json.tipografiaTexto}}", eslogan: "{{steps.ai1.json.eslogan}}" } }, position: { x: 700, y: 120 } },
      { id: "tpl1", type: "template", label: "Card de manual (receta)", config: { format: "post", maxItems: 1, recipe: { width: 1080, height: 1350, background: "#101014", html: `<main>\n  <header>\n    <span class="kicker">Manual de marca · v1</span>\n    <h1>{{marca}}</h1>\n    <em>{{eslogan}}</em>\n  </header>\n  <section class="swatches">\n    <div class="chip"><i style="background:{{colorPrimario}}"></i><span>Primario</span><code>{{colorPrimario}}</code></div>\n    <div class="chip"><i style="background:{{colorAcento}}"></i><span>Acento</span><code>{{colorAcento}}</code></div>\n    <div class="chip"><i style="background:{{colorFondo}}"></i><span>Fondo</span><code>{{colorFondo}}</code></div>\n  </section>\n  <section class="tipos">\n    <div><span>Titulares</span><strong style="font-family:'{{tipografiaTitulos}}'">Aa — {{tipografiaTitulos}}</strong></div>\n    <div><span>Texto</span><p style="font-family:'{{tipografiaTexto}}'">El veloz murciélago hindú comía feliz cardillo y kiwi.</p></div>\n  </section>\n  <footer><span>{{rubro}}</span><span>{{publico}}</span></footer>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;grid-template-rows:auto 1fr auto;gap:44px;padding:76px;background:{{colorFondo}};color:#fff;font-family:'{{tipografiaTexto}}',sans-serif}.kicker{font-size:22px;letter-spacing:4px;text-transform:uppercase;color:{{colorAcento}}}h1{font-family:'{{tipografiaTitulos}}',sans-serif;font-size:110px;line-height:1;margin-top:18px}em{display:block;margin-top:14px;font-size:34px;color:rgba(255,255,255,.75)}.swatches{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}.chip{border:1px solid rgba(255,255,255,.14);border-radius:20px;padding:26px;display:grid;gap:12px}.chip i{display:block;height:110px;border-radius:14px}.chip span{font-size:20px;color:rgba(255,255,255,.6)}code{font-size:24px}.tipos{display:grid;gap:26px}.tipos span{font-size:20px;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,.5)}.tipos strong{font-size:56px}.tipos p{font-size:30px;line-height:1.45;color:rgba(255,255,255,.85)}footer{display:flex;justify-content:space-between;font-size:24px;color:rgba(255,255,255,.55)}` } }, position: { x: 1040, y: 120 } },
      { id: "rep1", type: "report", label: "Reporte", config: { title: "Manual de marca" }, position: { x: 1380, y: 120 } },
    ],
    edges: [
      { from: "map1", to: "ai1" }, { from: "ai1", to: "map2" },
      { from: "map2", to: "tpl1" }, { from: "tpl1", to: "rep1" },
    ],
  },
  {
    id: "preset_investigacion_web",
    name: "Investigación web con IA (research)",
    description: "La IA investiga EN LA WEB (webSearch nativo del proveedor: gemini/anthropic/openrouter) y entrega un brief ejecutivo con fuentes. Cero keys de búsqueda: la cuota es la del propio proveedor.",
    trigger: { type: "manual" },
    inputs: [
      { key: "tema", label: "¿Qué investigar?", type: "text", required: true, default: "tendencias de diseño gráfico 2026" },
      { key: "enfoque", label: "Enfoque o preguntas guía", type: "textarea", required: false, default: "qué estilos dominan en branding de cafeterías y restaurantes" },
    ],
    nodes: [
      { id: "ai1", type: "ai", label: "Research web", config: { provider: "openrouter", model: "", credentialId: null, webSearch: true, systemPrompt: "Eres analista de investigación. Buscas en la web con tu capacidad nativa y escribes un brief ejecutivo en español: contexto (3-4 líneas), 5 hallazgos con dato concreto cada uno, 3 oportunidades y 3 riesgos. Cita la fuente (nombre del sitio) entre paréntesis en cada hallazgo. Máx 400 palabras.", prompt: "Tema: {{input.tema}}\nEnfoque: {{input.enfoque}}", maxOutputTokens: 1_200 }, position: { x: 40, y: 120 } },
      { id: "rep1", type: "report", label: "Brief ejecutivo", config: { title: "Research: {{input.tema}}" }, position: { x: 380, y: 120 } },
    ],
    edges: [ { from: "ai1", to: "rep1" } ],
  },
  {
    id: "preset_evento_recordatorio",
    name: "Evento: post recordatorio (receta viva)",
    description: "Datos del evento → story con countdown tipográfico listo para publicar. Sin plantilla previa; pide evento y fecha al correr (mini-form) y el humano puede cambiar la receta por SU frame después.",
    trigger: { type: "manual" },
    inputs: [
      { key: "evento", label: "Nombre del evento", type: "text", required: true, default: "Futuraria Conf 2026" },
      { key: "fecha", label: "Fecha", type: "date", required: true, default: "2026-10-20" },
      { key: "ciudad", label: "Lugar / ciudad", type: "text", required: false, default: "Lima" },
    ],
    nodes: [
      { id: "map1", type: "map", label: "Datos del evento", config: { value: { evento: "{{input.evento}}", fecha: "{{input.fecha}}", ciudad: "{{input.ciudad}}" } }, position: { x: 40, y: 120 } },
      { id: "tpl1", type: "template", label: "Story recordatorio (receta)", config: { format: "story", maxItems: 1, recipe: { width: 1080, height: 1920, background: "#0c0c0e", html: `<main>\n  <span class="kicker">Guarda la fecha</span>\n  <h1>{{evento}}</h1>\n  <div class="fecha">{{fecha}}</div>\n  <div class="ciudad">{{ciudad}}</div>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;justify-items:center;gap:34px;padding:90px;text-align:center;background:radial-gradient(120% 90% at 50% 0%,#1c2a1e 0%,#0c0c0e 62%);color:#f5fff0;font-family:Georgia,serif}.kicker{font-size:26px;letter-spacing:8px;text-transform:uppercase;color:#b7f26d}h1{font-size:120px;line-height:1.04;max-width:820px}.fecha{font-size:64px;font-weight:700;color:#b7f26d;border:2px solid #b7f26d;border-radius:999px;padding:18px 56px}.ciudad{font-size:38px;color:rgba(245,255,240,.7)}` } }, position: { x: 380, y: 120 } },
    ],
    edges: [ { from: "map1", to: "tpl1" } ],
  },
  {
    id: "preset_copys_lote",
    name: "Copys en lote → calendario + cards",
    description: "Tema + fecha inicial → la IA redacta hasta 5 copys (gancho, cuerpo, CTA, hashtags), los agenda como ideas en el calendario de contenidos y viste UNA CARD por copy. Cada card es un archivo editable; publicar sigue siendo tu click (publish_content).",
    trigger: { type: "manual" },
    inputs: [
      { key: "tema", label: "¿De qué son los copys?", type: "text", required: true, default: "lanzamiento del menú de otoño" },
      { key: "cantidad", label: "¿Cuántos copys? (1-5)", type: "number", required: false, default: "3" },
      { key: "fechaInicio", label: "Primera fecha de publicación", type: "date", required: true, default: "2026-10-12" },
      { key: "tono", label: "Tono o notas de marca", type: "textarea", required: false, default: "cercano, cero jerga, con humor ligero" },
    ],
    nodes: [
      { id: "map1", type: "map", label: "Brief", config: { value: { tema: "{{input.tema}}", cantidad: "{{input.cantidad}}", fechaInicio: "{{input.fechaInicio}}", tono: "{{input.tono}}" } }, position: { x: 40, y: 120 } },
      { id: "ai1", type: "ai", label: "Redactor de copys", config: { provider: "openrouter", model: "", credentialId: null, responseFormat: "json", systemPrompt: "Eres copywriter senior de redes sociales. Con el brief, redactas los N copys pedidos, listos para publicar. Responde SOLO un JSON array (sin texto extra ni fences) con un objeto por copy: {\"fecha\": \"YYYY-MM-DD\" (días consecutivos desde la fecha inicial), \"gancho\": máx 60 caracteres, \"cuerpo\": 2-3 frases, \"cta\": una llamada a la acción corta, \"hashtags\": 3-5 hashtags separados por espacio}. Español neutro.", prompt: "Tema: {{steps.map1.tema}}\nCantidad de copys: {{steps.map1.cantidad}} (máximo 5)\nPrimera fecha: {{steps.map1.fechaInicio}}\nTono / notas: {{steps.map1.tono}}", maxOutputTokens: 2_000, schema: { type: "array", items: { type: "object", required: ["fecha", "gancho", "cuerpo", "cta", "hashtags"], properties: { fecha: { type: "string" }, gancho: { type: "string" }, cuerpo: { type: "string" }, cta: { type: "string" }, hashtags: { type: "string" } } } } }, position: { x: 360, y: 120 } },
      { id: "map2", type: "map", label: "Aplanar copys", config: { value: "{{steps.ai1.json}}" }, position: { x: 680, y: 120 } },
      { id: "cal1", type: "tool", label: "Ideas al calendario", config: { tool: "add_content_idea", perItem: true, args: { scheduledDate: "{{item.fecha}}", topic: "{{item.gancho}}", copy: "{{item.gancho}}\n\n{{item.cuerpo}}\n\n{{item.cta}}\n{{item.hashtags}}" } }, position: { x: 1000, y: 40 } },
      { id: "tpl1", type: "template", label: "Card por copy (receta)", config: { format: "post", maxItems: 5, recipe: { width: 1080, height: 1350, background: "#101014", html: `<main>\n  <span class="kicker">{{fecha}} · idea</span>\n  <h1>{{gancho}}</h1>\n  <p class="cuerpo">{{cuerpo}}</p>\n  <div class="cta">{{cta}}</div>\n  <footer>{{hashtags}}</footer>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;grid-template-rows:auto 1fr auto auto;gap:40px;align-content:center;padding:88px;background:radial-gradient(120% 100% at 50% 0%,#1a1a22 0%,#101014 60%);color:#f5f5f7;font-family:Georgia,serif}.kicker{font-size:24px;letter-spacing:6px;text-transform:uppercase;color:#b7f26d}h1{font-size:86px;line-height:1.06}.cuerpo{font-size:38px;line-height:1.5;color:rgba(245,245,247,.82);max-width:880px}.cta{justify-self:start;font-size:34px;font-weight:700;color:#101014;background:#b7f26d;border-radius:999px;padding:20px 54px}footer{font-size:30px;color:rgba(245,245,247,.55)}` } }, position: { x: 1000, y: 220 } },
      { id: "rep1", type: "report", label: "Reporte", config: { title: "Copys en lote" }, position: { x: 1340, y: 120 } },
    ],
    edges: [
      { from: "map1", to: "ai1" }, { from: "ai1", to: "map2" },
      { from: "map2", to: "cal1" }, { from: "map2", to: "tpl1" },
      { from: "cal1", to: "rep1" }, { from: "tpl1", to: "rep1" },
    ],
  },
  {
    id: "preset_copys_lote_ia",
    name: "Copys en lote con TU IA (sin key)",
    description: "Igual que Copys en lote, pero SIN key de IA: el flow deja el encargo a TU IA (la que tengas conectada a Musa — Claude, Chatgpt, Codex, Hermes...). Ella redacta los copys y los entrega con flow_ai_complete; el flow sigue solo: ideas al calendario + UNA CARD por copy. La tarea la ves con flow_ai_tasks (y te llega el wake si está configurado).",
    trigger: { type: "manual" },
    inputs: [
      { key: "tema", label: "¿De qué son los copys?", type: "text", required: true, default: "lanzamiento del menú de otoño" },
      { key: "cantidad", label: "¿Cuántos copys? (1-5)", type: "number", required: false, default: "3" },
      { key: "fechaInicio", label: "Primera fecha de publicación", type: "date", required: true, default: "2026-10-12" },
      { key: "tono", label: "Tono o notas de marca", type: "textarea", required: false, default: "cercano, cero jerga, con humor ligero" },
    ],
    nodes: [
      { id: "map1", type: "map", label: "Brief", config: { value: { tema: "{{input.tema}}", cantidad: "{{input.cantidad}}", fechaInicio: "{{input.fechaInicio}}", tono: "{{input.tono}}" } }, position: { x: 40, y: 120 } },
      { id: "aitask1", type: "ai_task", label: "Encargo a tu IA", config: { title: "Redacta los copys", timeoutMinutes: 240, prompt: "Eres el copywriter senior de esta marca. Redacta la cantidad de copys pedida (máximo 5) sobre \"{{steps.map1.tema}}\", tono/notas: {{steps.map1.tono}}.\nCada copy lleva: \"fecha\" YYYY-MM-DD (días consecutivos desde {{steps.map1.fechaInicio}}), \"gancho\" (máx 60 caracteres), \"cuerpo\" (2-3 frases), \"cta\" (llamada a la acción corta) y \"hashtags\" (3-5, separados por espacio). Español neutro.\nCuando termines, llama la tool flow_ai_complete con el resumeToken de esta tarea y payload:{copys:[{fecha,gancho,cuerpo,cta,hashtags},...]} — payload es un OBJETO con el array \"copys\" anidado." }, position: { x: 360, y: 120 } },
      { id: "map2", type: "map", label: "Aplanar copys", config: { value: "{{steps.aitask1.copys}}" }, position: { x: 680, y: 120 } },
      { id: "cal1", type: "tool", label: "Ideas al calendario", config: { tool: "add_content_idea", perItem: true, args: { scheduledDate: "{{item.fecha}}", topic: "{{item.gancho}}", copy: "{{item.gancho}}\n\n{{item.cuerpo}}\n\n{{item.cta}}\n{{item.hashtags}}" } }, position: { x: 1000, y: 40 } },
      { id: "tpl1", type: "template", label: "Card por copy (receta)", config: { format: "post", maxItems: 5, recipe: { width: 1080, height: 1350, background: "#101014", html: `<main>\n  <span class="kicker">{{fecha}} · idea</span>\n  <h1>{{gancho}}</h1>\n  <p class="cuerpo">{{cuerpo}}</p>\n  <div class="cta">{{cta}}</div>\n  <footer>{{hashtags}}</footer>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;grid-template-rows:auto 1fr auto auto;gap:40px;align-content:center;padding:88px;background:radial-gradient(120% 100% at 50% 0%,#1a1a22 0%,#101014 60%);color:#f5f5f7;font-family:Georgia,serif}.kicker{font-size:24px;letter-spacing:6px;text-transform:uppercase;color:#b7f26d}h1{font-size:86px;line-height:1.06}.cuerpo{font-size:38px;line-height:1.5;color:rgba(245,245,247,.82);max-width:880px}.cta{justify-self:start;font-size:34px;font-weight:700;color:#101014;background:#b7f26d;border-radius:999px;padding:20px 54px}footer{font-size:30px;color:rgba(245,245,247,.55)}` } }, position: { x: 1000, y: 220 } },
      { id: "rep1", type: "report", label: "Reporte", config: { title: "Copys en lote (tu IA)" }, position: { x: 1340, y: 120 } },
    ],
    edges: [
      { from: "map1", to: "aitask1" }, { from: "aitask1", to: "map2" },
      { from: "map2", to: "cal1" }, { from: "map2", to: "tpl1" },
      { from: "cal1", to: "rep1" }, { from: "tpl1", to: "rep1" },
    ],
  },
  // ── Catálogo de plantillas de Ren (Flows.md): 15 familias nuevas ──────────
  // Regla: TODAS terminan en un nodo preview (directo o via merge) — el run
  // siempre deja el resultado generado a la vista. Los determinísticos (sin
  // nodo ai) corren al instante y NO piden key de IA.
  {
    id: "preset_manual_marca_full",
    name: "Manual de marca completo (receta viva)",
    description: "La extendida: la IA investiga el rubro (webSearch del proveedor), define la identidad en JSON y viste 4 cards — logotipo, paleta, tipografías y portada social — que revisas de corrido en la vista previa final.",
    trigger: { type: "manual" },
    inputs: [
      { key: "marca", label: "Marca", type: "text", required: true, default: "Café Borja" },
      { key: "rubro", label: "Rubro / categoría", type: "text", required: false, default: "cafetería de especialidad" },
      { key: "publico", label: "Público objetivo", type: "text", required: false, default: "jóvenes profesionales de Lima" },
    ],
    nodes: [
      { id: "map1", type: "map", label: "Brief", config: { value: { marca: "{{input.marca}}", rubro: "{{input.rubro}}", publico: "{{input.publico}}" } }, position: { x: 40, y: 120 } },
      { id: "ai1", type: "ai", label: "Investiga y define", config: { provider: "openrouter", model: "", credentialId: null, webSearch: true, responseFormat: "json", systemPrompt: "Eres director de arte. Con el brief, investiga referencias reales del rubro y define una identidad PODEROSA y distinta. Responde SOLO JSON con: colorPrimario, colorAcento y colorFondo en hex (#rrggbb), tipografiaTitulos y tipografiaTexto (parejas Google Fonts reales), eslogan (máx 8 palabras, español).", prompt: "Marca: {{steps.map1.marca}}\nRubro: {{steps.map1.rubro}}\nPúblico: {{steps.map1.publico}}", maxOutputTokens: 700, schema: { type: "object", required: ["colorPrimario", "colorAcento", "colorFondo", "tipografiaTitulos", "tipografiaTexto", "eslogan"], properties: { colorPrimario: { type: "string" }, colorAcento: { type: "string" }, colorFondo: { type: "string" }, tipografiaTitulos: { type: "string" }, tipografiaTexto: { type: "string" }, eslogan: { type: "string" } } } }, position: { x: 360, y: 120 } },
      { id: "map2", type: "map", label: "Tokens de marca", config: { value: { marca: "{{input.marca}}", rubro: "{{input.rubro}}", publico: "{{input.publico}}", colorPrimario: "{{steps.ai1.json.colorPrimario}}", colorAcento: "{{steps.ai1.json.colorAcento}}", colorFondo: "{{steps.ai1.json.colorFondo}}", tipografiaTitulos: "{{steps.ai1.json.tipografiaTitulos}}", tipografiaTexto: "{{steps.ai1.json.tipografiaTexto}}", eslogan: "{{steps.ai1.json.eslogan}}" } }, position: { x: 700, y: 120 } },
      { id: "tpl_logo", type: "template", label: "Card logotipo (receta)", config: { format: "post", maxItems: 1, recipe: { width: 1080, height: 1350, background: "#101014", html: `<main>\n  <span class="kicker">Manual de marca · 01 / Logotipo</span>\n  <div class="logo">{{marca}}</div>\n  <em>{{eslogan}}</em>\n  <div class="normas"><span>Área de respeto: medio logo libre a cada lado</span><span>Tamaño mínimo: 120 px de ancho</span></div>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;gap:44px;padding:90px;background:radial-gradient(120% 90% at 50% 0%,rgba(255,255,255,.07) 0%,transparent 60%),{{colorFondo}};color:#fff;font-family:'{{tipografiaTexto}}',sans-serif}.kicker{font-size:22px;letter-spacing:5px;text-transform:uppercase;color:{{colorAcento}}}.logo{font-family:'{{tipografiaTitulos}}',sans-serif;font-size:140px;line-height:1.05;color:{{colorPrimario}};border:5px solid {{colorPrimario}};border-radius:36px;padding:36px 56px;justify-self:start}em{font-size:40px;color:rgba(255,255,255,.8)}.normas{display:grid;gap:12px;border-top:1px solid rgba(255,255,255,.16);padding-top:28px}.normas span{font-size:26px;color:rgba(255,255,255,.55)}` } }, position: { x: 1040, y: 40 } },
      { id: "tpl_paleta", type: "template", label: "Card paleta (receta)", config: { format: "post", maxItems: 1, recipe: { width: 1080, height: 1350, background: "#101014", html: `<main>\n  <span class="kicker">Manual de marca · 02 / Paleta</span>\n  <section class="swatches">\n    <div class="chip"><i style="background:{{colorPrimario}}"></i><span>Primario</span><code>{{colorPrimario}}</code></div>\n    <div class="chip"><i style="background:{{colorAcento}}"></i><span>Acento</span><code>{{colorAcento}}</code></div>\n    <div class="chip"><i style="background:{{colorFondo}};border:1px solid rgba(255,255,255,.25)"></i><span>Fondo</span><code>{{colorFondo}}</code></div>\n  </section>\n  <p class="uso">El primario lidera piezas y botones; el acento se reserva para llamados de atención.</p>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;gap:48px;padding:84px;background:{{colorFondo}};color:#fff;font-family:'{{tipografiaTexto}}',sans-serif}.kicker{font-size:22px;letter-spacing:5px;text-transform:uppercase;color:{{colorAcento}}}.swatches{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}.chip{border:1px solid rgba(255,255,255,.14);border-radius:20px;padding:26px;display:grid;gap:14px}.chip i{display:block;height:130px;border-radius:14px}.chip span{font-size:20px;color:rgba(255,255,255,.6)}code{font-size:24px}.uso{font-size:30px;line-height:1.5;color:rgba(255,255,255,.75);max-width:880px}` } }, position: { x: 1040, y: 240 } },
      { id: "tpl_tipos", type: "template", label: "Card tipografías (receta)", config: { format: "post", maxItems: 1, recipe: { width: 1080, height: 1350, background: "#101014", html: `<main>\n  <span class="kicker">Manual de marca · 03 / Tipografías</span>\n  <div class="fila"><span>Titulares</span><strong style="font-family:'{{tipografiaTitulos}}'">Aa — {{tipografiaTitulos}}</strong></div>\n  <div class="fila"><span>Texto</span><p style="font-family:'{{tipografiaTexto}}'">El veloz murciélago hindú comía feliz cardillo y kiwi.</p></div>\n  <div class="fila"><span>Jerarquía</span><div class="escala"><b style="font-family:'{{tipografiaTitulos}}'">H1</b><b style="font-family:'{{tipografiaTitulos}}';font-size:64px">H2</b><b style="font-family:'{{tipografiaTitulos}}';font-size:48px">H3</b><span>cuerpo</span></div></div>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;gap:52px;padding:84px;background:{{colorFondo}};color:#fff;font-family:'{{tipografiaTexto}}',sans-serif}.kicker{font-size:22px;letter-spacing:5px;text-transform:uppercase;color:{{colorAcento}}}.fila{display:grid;gap:18px;border-top:1px solid rgba(255,255,255,.14);padding-top:34px}.fila>span{font-size:20px;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,.5)}.fila strong{font-size:58px}.fila p{font-size:32px;line-height:1.45;color:rgba(255,255,255,.85)}.escala{display:flex;align-items:baseline;gap:38px}.escala b{font-size:88px;color:{{colorPrimario}}}` } }, position: { x: 1040, y: 440 } },
      { id: "tpl_social", type: "template", label: "Portada social (receta)", config: { format: "story", maxItems: 1, recipe: { width: 1080, height: 1920, background: "#101014", html: `<main>\n  <span class="kicker">{{marca}} en redes</span>\n  <h1>{{eslogan}}</h1>\n  <div class="chips"><i style="background:{{colorPrimario}}"></i><i style="background:{{colorAcento}}"></i></div>\n  <footer><span>Plantillas sociales con esta identidad</span><span>{{rubro}}</span></footer>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;justify-items:center;gap:52px;padding:100px;text-align:center;background:radial-gradient(120% 80% at 50% 0%,rgba(255,255,255,.08) 0%,transparent 55%),{{colorFondo}};color:#fff;font-family:'{{tipografiaTexto}}',sans-serif}.kicker{font-size:26px;letter-spacing:6px;text-transform:uppercase;color:{{colorAcento}}}h1{font-family:'{{tipografiaTitulos}}',sans-serif;font-size:110px;line-height:1.08;max-width:800px}.chips{display:flex;gap:26px}.chips i{display:block;width:96px;height:96px;border-radius:50%}footer{position:fixed;bottom:60px;left:0;right:0;display:flex;justify-content:space-between;padding:0 90px;font-size:24px;color:rgba(255,255,255,.5)}` } }, position: { x: 1040, y: 640 } },
      { id: "merge1", type: "merge", label: "Juntar cards", config: { mode: "append" }, position: { x: 1400, y: 340 } },
      { id: "prev1", type: "preview", label: "Ver el manual", config: { title: "Manual de marca" }, position: { x: 1680, y: 340 } },
    ],
    edges: [
      { from: "map1", to: "ai1" }, { from: "ai1", to: "map2" },
      { from: "map2", to: "tpl_logo" }, { from: "map2", to: "tpl_paleta" }, { from: "map2", to: "tpl_tipos" }, { from: "map2", to: "tpl_social" },
      { from: "tpl_logo", to: "merge1" }, { from: "tpl_paleta", to: "merge1" }, { from: "tpl_tipos", to: "merge1" }, { from: "tpl_social", to: "merge1" },
      { from: "merge1", to: "prev1" },
    ],
  },
  {
    id: "preset_design_system",
    name: "Design system digital (receta viva)",
    description: "La IA define el lenguaje visual digital (colores, tipografías, radio base) y viste 4 cards: tokens de color, escala tipográfica, botones y card, y el grid de espaciado. Todo queda en la vista previa final.",
    trigger: { type: "manual" },
    inputs: [
      { key: "marca", label: "Marca / producto", type: "text", required: true, default: "Kambio" },
      { key: "producto", label: "¿Qué construye? (app, web, SaaS...)", type: "text", required: false, default: "app de finanzas personales" },
      { key: "tono", label: "Tono visual (sobrio, juguetón, técnico...)", type: "textarea", required: false, default: "sobrio y confiable, con toques frescos" },
    ],
    nodes: [
      { id: "map1", type: "map", label: "Brief", config: { value: { marca: "{{input.marca}}", producto: "{{input.producto}}", tono: "{{input.tono}}" } }, position: { x: 40, y: 120 } },
      { id: "ai1", type: "ai", label: "Define el sistema", config: { provider: "openrouter", model: "", credentialId: null, responseFormat: "json", systemPrompt: "Eres design lead de producto digital. Con el brief defines un design system MODERNO y usable. Responde SOLO JSON con: colorPrimario, colorAcento y colorFondo en hex (#rrggbb), tipografiaTitulos y tipografiaTexto (parejas Google Fonts reales), radio (borde base: 8px, 12px o 16px).", prompt: "Marca: {{steps.map1.marca}}\nProducto: {{steps.map1.producto}}\nTono: {{steps.map1.tono}}", maxOutputTokens: 500, schema: { type: "object", required: ["colorPrimario", "colorAcento", "colorFondo", "tipografiaTitulos", "tipografiaTexto", "radio"], properties: { colorPrimario: { type: "string" }, colorAcento: { type: "string" }, colorFondo: { type: "string" }, tipografiaTitulos: { type: "string" }, tipografiaTexto: { type: "string" }, radio: { type: "string" } } } }, position: { x: 360, y: 120 } },
      { id: "map2", type: "map", label: "Tokens del sistema", config: { value: { marca: "{{input.marca}}", producto: "{{input.producto}}", colorPrimario: "{{steps.ai1.json.colorPrimario}}", colorAcento: "{{steps.ai1.json.colorAcento}}", colorFondo: "{{steps.ai1.json.colorFondo}}", tipografiaTitulos: "{{steps.ai1.json.tipografiaTitulos}}", tipografiaTexto: "{{steps.ai1.json.tipografiaTexto}}", radio: "{{steps.ai1.json.radio}}" } }, position: { x: 700, y: 120 } },
      { id: "tpl_colores", type: "template", label: "Tokens de color (receta)", config: { format: "post", maxItems: 1, recipe: { width: 1080, height: 1350, background: "#101014", html: `<main>\n  <span class="kicker">Design system · 01 / Tokens de color</span>\n  <section class="swatches">\n    <div class="chip"><i style="background:{{colorPrimario}}"></i><span>--color-primario</span><code>{{colorPrimario}}</code></div>\n    <div class="chip"><i style="background:{{colorAcento}}"></i><span>--color-acento</span><code>{{colorAcento}}</code></div>\n    <div class="chip"><i style="background:{{colorFondo}};border:1px solid rgba(255,255,255,.25)"></i><span>--color-fondo</span><code>{{colorFondo}}</code></div>\n  </section>\n  <footer>{{marca}} · {{producto}}</footer>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;gap:48px;padding:84px;background:{{colorFondo}};color:#fff;font-family:'{{tipografiaTexto}}',sans-serif}.kicker{font-size:22px;letter-spacing:5px;text-transform:uppercase;color:{{colorAcento}}}.swatches{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}.chip{border:1px solid rgba(255,255,255,.14);border-radius:20px;padding:26px;display:grid;gap:14px}.chip i{display:block;height:130px;border-radius:14px}.chip span{font-size:19px;color:rgba(255,255,255,.6)}code{font-size:24px}footer{font-size:26px;color:rgba(255,255,255,.5)}` } }, position: { x: 1040, y: 40 } },
      { id: "tpl_tipos", type: "template", label: "Escala tipográfica (receta)", config: { format: "post", maxItems: 1, recipe: { width: 1080, height: 1350, background: "#101014", html: `<main>\n  <span class="kicker">Design system · 02 / Escala tipográfica</span>\n  <b class="m1" style="font-family:'{{tipografiaTitulos}}'">Display 64</b>\n  <b class="m2" style="font-family:'{{tipografiaTitulos}}'">Heading 40</b>\n  <b class="m3" style="font-family:'{{tipografiaTitulos}}'">Título 28</b>\n  <p class="m4" style="font-family:'{{tipografiaTexto}}'">Cuerpo 20 — {{tipografiaTexto}}. El veloz murciélago hindú comía feliz cardillo y kiwi.</p>\n  <p class="m5">Caption 15 — metadatos, labels y ayuda.</p>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;gap:34px;padding:84px;background:{{colorFondo}};color:#fff;font-family:'{{tipografiaTexto}}',sans-serif}.kicker{font-size:22px;letter-spacing:5px;text-transform:uppercase;color:{{colorAcento}};margin-bottom:18px}.m1{font-size:96px}.m2{font-size:60px}.m3{font-size:42px}.m4{font-size:30px;line-height:1.5;color:rgba(255,255,255,.85);max-width:900px}.m5{font-size:22px;color:rgba(255,255,255,.55)}` } }, position: { x: 1040, y: 240 } },
      { id: "tpl_componentes", type: "template", label: "Botones y card (receta)", config: { format: "post", maxItems: 1, recipe: { width: 1080, height: 1350, background: "#101014", html: `<main>\n  <span class="kicker">Design system · 03 / Componentes</span>\n  <div class="fila"><button class="primario">Acción principal</button><button class="secundario">Secundaria</button></div>\n  <div class="card"><h2>Card de contenido</h2><p>Cuerpo de la card con {{radio}} de borde y sombra suave. El estado hover sube 2 px.</p><span class="tag">Etiqueta</span></div>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;gap:56px;padding:84px;background:{{colorFondo}};color:#fff;font-family:'{{tipografiaTexto}}',sans-serif}.kicker{font-size:22px;letter-spacing:5px;text-transform:uppercase;color:{{colorAcento}}}.fila{display:flex;gap:28px}button{font-size:30px;border-radius:{{radio}};padding:24px 48px;font-family:inherit}.primario{background:{{colorPrimario}};color:#fff;border:0}.secundario{background:transparent;color:{{colorPrimario}};border:3px solid {{colorPrimario}}}.card{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:{{radio}};padding:44px;display:grid;gap:20px;max-width:820px}.card h2{font-family:'{{tipografiaTitulos}}',sans-serif;font-size:44px}.card p{font-size:28px;line-height:1.5;color:rgba(255,255,255,.75)}.tag{justify-self:start;font-size:22px;color:{{colorAcento}};border:2px solid {{colorAcento}};border-radius:999px;padding:8px 24px}` } }, position: { x: 1040, y: 440 } },
      { id: "tpl_grid", type: "template", label: "Espaciado y grid (receta)", config: { format: "post", maxItems: 1, recipe: { width: 1080, height: 1350, background: "#101014", html: `<main>\n  <span class="kicker">Design system · 04 / Espaciado</span>\n  <div class="escala">\n    <div><i style="width:32px"></i><span>8</span></div>\n    <div><i style="width:64px"></i><span>16</span></div>\n    <div><i style="width:96px"></i><span>24</span></div>\n    <div><i style="width:160px"></i><span>40</span></div>\n    <div><i style="width:256px"></i><span>64</span></div>\n  </div>\n  <p class="uso">Base 8 px: paddings, márgenes y gaps siempre múltiplos de 8.</p>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;gap:52px;padding:84px;background:{{colorFondo}};color:#fff;font-family:'{{tipografiaTexto}}',sans-serif}.kicker{font-size:22px;letter-spacing:5px;text-transform:uppercase;color:{{colorAcento}}}.escala{display:grid;gap:26px}.escala div{display:flex;align-items:center;gap:24px}.escala i{display:block;height:34px;background:{{colorPrimario}};border-radius:6px}.escala span{font-size:28px;color:rgba(255,255,255,.7)}.uso{font-size:30px;color:rgba(255,255,255,.75);max-width:860px}` } }, position: { x: 1040, y: 640 } },
      { id: "merge1", type: "merge", label: "Juntar cards", config: { mode: "append" }, position: { x: 1400, y: 340 } },
      { id: "prev1", type: "preview", label: "Ver el sistema", config: { title: "Design system" }, position: { x: 1680, y: 340 } },
    ],
    edges: [
      { from: "map1", to: "ai1" }, { from: "ai1", to: "map2" },
      { from: "map2", to: "tpl_colores" }, { from: "map2", to: "tpl_tipos" }, { from: "map2", to: "tpl_componentes" }, { from: "map2", to: "tpl_grid" },
      { from: "tpl_colores", to: "merge1" }, { from: "tpl_tipos", to: "merge1" }, { from: "tpl_componentes", to: "merge1" }, { from: "tpl_grid", to: "merge1" },
      { from: "merge1", to: "prev1" },
    ],
  },
  {
    id: "preset_content_machine",
    name: "Content Machine: calendario + posts + diseños con TU IA (sin key)",
    description: "Un click: llenas el brief (tema, fechas, canales y la guía visual — design system, plantillas o ambos) y TU IA conectada deja TODO hecho por etapas visibles: 1) plan de calendario, 2) entradas en Calendario/Contenidos, 3) copys redactadas y 4) un diseño con sus textos por pieza en Templates. Sin APIs ni key: tu IA atiende 3 tareas cortas (flow_ai_tasks) y los nodos deterministicos hacen las escrituras. Nada se publica: todo queda en «diseño» para tu revisión.",
    trigger: { type: "manual", entry: "map1", position: { x: 40, y: 120 } },
    inputs: [
      { key: "tema", label: "Tema o campaña", type: "textarea", required: true, default: "Lanzamiento de la colección de otoño: bebidas calientes de calabaza y canela" },
      { key: "fechaInicio", label: "Primera fecha de publicación", type: "date", required: true, default: "2026-10-12" },
      { key: "dias", label: "¿Cuántos días de calendario?", type: "number", required: false, default: "7" },
      { key: "canales", label: "Canales (separados por coma)", type: "text", required: false, default: "instagram, tiktok" },
      { key: "porDia", label: "Piezas por día", type: "number", required: false, default: "1" },
      { key: "tono", label: "Tono o notas de marca", type: "textarea", required: false, default: "cercano y cálido, cero jerga, humor ligero, español neutro" },
      { key: "modo", label: "Guía visual", type: "select", required: false, default: "ambos", options: [
        { value: "ds", label: "Solo design system" },
        { value: "plantillas", label: "Solo mis plantillas" },
        { value: "ambos", label: "Ambos (plantillas + design system)" },
      ] },
      { key: "marca", label: "Marca / Design system", type: "select", required: false, default: "Café Borja", optionsFrom: "brands" },
      { key: "plantillas", label: "Plantillas guía (nombres o ids, opcional)", type: "textarea", required: false, default: "Post lanzamiento, Post producto, Carrusel de tips" },
    ],
    nodes: [
      { id: "map1", type: "map", label: "Brief", config: { value: { tema: "{{input.tema}}", fechaInicio: "{{input.fechaInicio}}", dias: "{{input.dias}}", canales: "{{input.canales}}", porDia: "{{input.porDia}}", tono: "{{input.tono}}", modo: "{{input.modo}}", marca: "{{input.marca}}", plantillas: "{{input.plantillas}}" } }, position: { x: 320, y: 120 } },
      { id: "plan1", type: "ai_task", label: "IA: plan de calendario", config: { title: "Content machine 1/3: plan de calendario", timeoutMinutes: 60, requiredKeys: ["piezas"], prompt: "Eres el estratega de contenido de esta marca. Con el brief, arma el plan del calendario: EXACTAMENTE {{steps.map1.dias}} día(s) x {{steps.map1.porDia}} pieza(s) por día.\nBRIEF — tema: \"{{steps.map1.tema}}\"; primera fecha: {{steps.map1.fechaInicio}}; canales disponibles: {{steps.map1.canales}}; tono/notas: {{steps.map1.tono}}.\nREGLAS:\n1) Fechas consecutivas en YYYY-MM-DD empezando en {{steps.map1.fechaInicio}}; si porDia es mayor a 1, varias piezas el mismo día.\n2) Reparte los canales entre las piezas rotándolos; usa SOLO canales de la lista.\n3) Cada pieza con topic propio (máx 60 caracteres), ángulos variados y alineados al tema y al tono — nada genérico.\n4) En esta etapa NO toques Musa: no crees entradas ni diseños; solo planifica.\nENTREGA: llama flow_ai_complete con el resumeToken de esta tarea y payload:{piezas:[{fecha, canal, topic},...]} — payload es un OBJETO con el array \"piezas\" anidado." }, position: { x: 600, y: 120 } },
      { id: "map2", type: "map", label: "Aplanar plan", config: { value: "{{steps.plan1.piezas}}" }, position: { x: 880, y: 120 } },
      { id: "cal1", type: "tool", label: "Calendario: ideas al día", config: { tool: "add_content_idea", perItem: true, args: { scheduledDate: "{{item.fecha}}", topic: "{{item.topic}}", campaign: "{{steps.map1.tema}}", notes: "Canal: {{item.canal}}" } }, position: { x: 1160, y: 120 } },
      { id: "copy1", type: "ai_task", label: "IA: copys de cada pieza", config: { title: "Content machine 2/3: copys de cada pieza", timeoutMinutes: 120, requiredKeys: ["copys"], prompt: "Eres el copywriter senior de la marca \"{{steps.map1.marca}}\". El plan ya está en el calendario: entradas con topic y fecha bajo la campaña \"{{steps.map1.tema}}\".\nPASOS:\n1) Recupera esas entradas con list_calendar_entries (rango desde {{steps.map1.fechaInicio}}) y liga cada entrada (id cc_...) con su topic y fecha.\n2) Por cada entrada redacta la copy completa: \"gancho\" (máx 60 caracteres), \"cuerpo\" (2-3 frases), \"cta\" (llamada corta) y \"hashtags\" (3-5, separados por espacio). Tono: {{steps.map1.tono}}. Español neutro. Varía el gancho entre piezas; cero relleno.\n3) No escribas nada en Musa todavía: solo redacta.\nENTREGA: llama flow_ai_complete con el resumeToken de esta tarea y payload:{copys:[{entryId, gancho, cuerpo, cta, hashtags},...]} — entryId es el id cc_ de cada entrada; payload es un OBJETO con el array \"copys\" anidado." }, position: { x: 1440, y: 120 } },
      { id: "map3", type: "map", label: "Aplanar copys", config: { value: "{{steps.copy1.copys}}" }, position: { x: 1720, y: 120 } },
      { id: "upd1", type: "tool", label: "Copys al calendario", config: { tool: "update_content", perItem: true, args: { id: "{{item.entryId}}", copy: "{{item.gancho}}\n\n{{item.cuerpo}}\n\n{{item.cta}}\n{{item.hashtags}}", status: "diseño" } }, position: { x: 2000, y: 120 } },
      { id: "des1", type: "ai_task", label: "IA: diseños + textos", config: { title: "Content machine 3/3: diseños + textos de cada pieza", timeoutMinutes: 240, requiredKeys: ["piezas"], prompt: "Eres el diseñador de la marca \"{{steps.map1.marca}}\". Las entradas de la campaña \"{{steps.map1.tema}}\" ya tienen copy (status \"diseño\"); falta SU diseño con sus textos.\nGUÍA VISUAL (modo: {{steps.map1.modo}}):\n- \"ds\": estudia el design system de la marca (get_brands para ubicar \"{{steps.map1.marca}}\"; get_design_system, get_brand_playbook) y crea piezas fieles a esos tokens.\n- \"plantillas\": trabaja sobre las plantillas indicadas (\"{{steps.map1.plantillas}}\"; find_templates/get_template para verlas).\n- \"ambos\": parte de la estructura de esas plantillas y aplica los tokens del design system.\nSi el campo plantillas viene vacío, elige tú las mejores del workspace con find_templates y dilo en el resumen.\nPASOS (por cada entrada de la campaña, list_calendar_entries desde {{steps.map1.fechaInicio}}):\n1) Crea el diseño: duplicate_template (variante de la plantilla elegida) o create_html_template (pieza nueva con el DS).\n2) Redacta los TEXTOS DEL DISEÑO dentro del frame: titular (máx 8 palabras, derivado del gancho de la copy), cuerpo corto y cta visibles — nada de lorem ni placeholders.\n3) Pega el diseño a su entrada: update_content {id: entryId, templateId, frameId} (frameId exacto con get_template si el archivo es una grilla).\n4) PROHIBIDO publish_content: nada sale a redes.\nENTREGA: llama flow_ai_complete con el resumeToken de esta tarea y payload:{piezas:[{entryId, templateId, frameId, titular},...]} — payload es un OBJETO con el array \"piezas\" anidado." }, position: { x: 2280, y: 120 } },
      { id: "prev1", type: "preview", label: "Ver el resultado", config: { title: "Content Machine" }, position: { x: 2560, y: 120 } },
    ],
    edges: [
      { from: "map1", to: "plan1" }, { from: "plan1", to: "map2" }, { from: "map2", to: "cal1" },
      { from: "cal1", to: "copy1" }, { from: "copy1", to: "map3" }, { from: "map3", to: "upd1" },
      { from: "upd1", to: "des1" }, { from: "des1", to: "prev1" },
    ],
  },
  {
    id: "preset_animacion",
    name: "Post → animado: pieza + plan de motion (receta viva)",
    description: "Genera la pieza base Y su plan de animación: la IA elige preset de motion (exp-wiggle, exp-loop, exp-pulse), transición y ritmo del catálogo de video. La vista previa muestra la pieza y el plan; aplícalo en Video Mode o pídeselo a tu IA.",
    trigger: { type: "manual" },
    inputs: [
      { key: "marca", label: "Marca", type: "text", required: true, default: "Gymbro" },
      { key: "titular", label: "Titular de la pieza", type: "text", required: true, default: "Clase gratis este sábado" },
      { key: "subtitulo", label: "Subtítulo", type: "text", required: false, default: "Cupos limitados — reserva por DM" },
      { key: "estilo", label: "Estilo (elegante, enérgico, divertido...)", type: "text", required: false, default: "elegante" },
    ],
    nodes: [
      { id: "map1", type: "map", label: "Brief", config: { value: { marca: "{{input.marca}}", titular: "{{input.titular}}", subtitulo: "{{input.subtitulo}}", estilo: "{{input.estilo}}" } }, position: { x: 40, y: 120 } },
      { id: "ai1", type: "ai", label: "Plan de motion", config: { provider: "openrouter", model: "", credentialId: null, responseFormat: "json", systemPrompt: "Eres motion designer del catálogo de video de Musa. Dado el titular y el estilo, eliges la animación correcta. Responde SOLO JSON con: presetMotion (exp-wiggle para temblor enérgico, exp-loop para movimiento continuo, exp-pulse para latido destacado), transicion (un id común: fade, slide, push, zoom, whip-pan o glitch), segundos (duración del clip, entre 3 y 8) y notas (cómo aplicarlo, en una frase, español).", prompt: "Marca: {{steps.map1.marca}}\nTitular: {{steps.map1.titular}}\nSubtítulo: {{steps.map1.subtitulo}}\nEstilo pedido: {{steps.map1.estilo}}", maxOutputTokens: 400, schema: { type: "object", required: ["presetMotion", "transicion", "segundos", "notas"], properties: { presetMotion: { type: "string" }, transicion: { type: "string" }, segundos: { type: "string" }, notas: { type: "string" } } } }, position: { x: 360, y: 120 } },
      { id: "map2", type: "map", label: "Brief + plan", config: { value: { marca: "{{input.marca}}", titular: "{{input.titular}}", subtitulo: "{{input.subtitulo}}", presetMotion: "{{steps.ai1.json.presetMotion}}", transicion: "{{steps.ai1.json.transicion}}", segundos: "{{steps.ai1.json.segundos}}" } }, position: { x: 700, y: 120 } },
      { id: "tpl1", type: "template", label: "Pieza base (receta)", config: { format: "post", maxItems: 1, recipe: { width: 1080, height: 1350, background: "#101014", html: `<main>\n  <span class="kicker">{{marca}} · pieza para animar</span>\n  <h1>{{titular}}</h1>\n  <p class="sub">{{subtitulo}}</p>\n  <div class="plan">Animar con <b>{{presetMotion}}</b> · corte <b>{{transicion}}</b> · {{segundos}}s</div>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;gap:44px;padding:90px;background:radial-gradient(120% 100% at 50% 0%,#241522 0%,#101014 62%);color:#fff;font-family:Georgia,serif}.kicker{font-size:24px;letter-spacing:6px;text-transform:uppercase;color:#f472b6}h1{font-size:104px;line-height:1.05;max-width:880px}.sub{font-size:40px;color:rgba(255,255,255,.75)}.plan{border:2px solid #f472b6;border-radius:18px;padding:24px 34px;font-size:28px;color:rgba(255,255,255,.85);justify-self:start}.plan b{color:#f472b6}` } }, position: { x: 1040, y: 40 } },
      { id: "merge1", type: "merge", label: "Pieza + plan", config: { mode: "append" }, position: { x: 1400, y: 200 } },
      { id: "prev1", type: "preview", label: "Ver pieza + plan", config: { title: "Pieza + motion" }, position: { x: 1680, y: 200 } },
    ],
    edges: [
      { from: "map1", to: "ai1" }, { from: "ai1", to: "map2" }, { from: "map2", to: "tpl1" },
      { from: "ai1", to: "merge1" }, { from: "tpl1", to: "merge1" }, { from: "merge1", to: "prev1" },
    ],
  },
  {
    id: "preset_eventos_kit",
    name: "Kit de evento completo (receta viva)",
    description: "Sin IA y sin esperas: pones evento, fecha, ciudad y color de acento, y el flow viste 5 piezas — post inscríbete, story guarda la fecha, convocatoria de ponentes, post de gracias y fotocheck — todas visibles en la vista previa final.",
    trigger: { type: "manual" },
    inputs: [
      { key: "evento", label: "Nombre del evento", type: "text", required: true, default: "Futuraria Conf 2026" },
      { key: "fecha", label: "Fecha", type: "date", required: true, default: "2026-11-12" },
      { key: "ciudad", label: "Lugar / ciudad", type: "text", required: false, default: "Lima" },
      { key: "marca", label: "Marca organizadora", type: "text", required: false, default: "Futuraria" },
      { key: "acento", label: "Color de acento (hex)", type: "text", required: false, default: "#b7f26d" },
    ],
    nodes: [
      { id: "map1", type: "map", label: "Datos del evento", config: { value: { evento: "{{input.evento}}", fecha: "{{input.fecha}}", ciudad: "{{input.ciudad}}", marca: "{{input.marca}}", acento: "{{input.acento}}" } }, position: { x: 40, y: 440 } },
      { id: "tpl_inscribete", type: "template", label: "Post inscríbete (receta)", config: { format: "post", maxItems: 1, recipe: { width: 1080, height: 1350, background: "#0c0c0e", html: `<main>\n  <span class="kicker">Inscripciones abiertas</span>\n  <h1>{{evento}}</h1>\n  <div class="fecha">{{fecha}}</div>\n  <div class="ciudad">{{ciudad}}</div>\n  <div class="cta">Inscríbete ahora</div>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;justify-items:center;gap:36px;padding:90px;text-align:center;background:radial-gradient(120% 90% at 50% 0%,#1c2a1e 0%,#0c0c0e 62%);color:#f5fff0;font-family:Georgia,serif}.kicker{font-size:26px;letter-spacing:8px;text-transform:uppercase;color:{{acento}}}h1{font-size:120px;line-height:1.04;max-width:860px}.fecha{font-size:56px;font-weight:700;color:{{acento}}}.ciudad{font-size:38px;color:rgba(245,255,240,.7)}.cta{margin-top:12px;font-size:34px;font-weight:700;color:#0c0c0e;background:{{acento}};border-radius:999px;padding:22px 60px}` } }, position: { x: 400, y: 40 } },
      { id: "tpl_countdown", type: "template", label: "Story guarda la fecha (receta)", config: { format: "story", maxItems: 1, recipe: { width: 1080, height: 1920, background: "#0c0c0e", html: `<main>\n  <span class="kicker">Guarda la fecha</span>\n  <h1>{{evento}}</h1>\n  <div class="fecha">{{fecha}}</div>\n  <div class="ciudad">{{ciudad}}</div>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;justify-items:center;gap:34px;padding:90px;text-align:center;background:radial-gradient(120% 90% at 50% 0%,#1c2a1e 0%,#0c0c0e 62%);color:#f5fff0;font-family:Georgia,serif}.kicker{font-size:26px;letter-spacing:8px;text-transform:uppercase;color:{{acento}}}h1{font-size:120px;line-height:1.04;max-width:820px}.fecha{font-size:64px;font-weight:700;color:{{acento}};border:2px solid {{acento}};border-radius:999px;padding:18px 56px}.ciudad{font-size:38px;color:rgba(245,255,240,.7)}` } }, position: { x: 400, y: 240 } },
      { id: "tpl_ponentes", type: "template", label: "Convocatoria ponentes (receta)", config: { format: "post", maxItems: 1, recipe: { width: 1080, height: 1350, background: "#0c0c0e", html: `<main>\n  <span class="kicker">Convocatoria de ponentes</span>\n  <h1>¿Quieres hablar en {{evento}}?</h1>\n  <p class="cuerpo">Buscamos voces con historias reales de producto, diseño y negocio. 20 minutos, escenario principal.</p>\n  <div class="cta">Postula tu charla</div>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;justify-items:start;gap:44px;padding:90px;background:radial-gradient(120% 90% at 0% 0%,#1c2a1e 0%,#0c0c0e 60%);color:#f5fff0;font-family:Georgia,serif}.kicker{font-size:24px;letter-spacing:7px;text-transform:uppercase;color:{{acento}}}h1{font-size:96px;line-height:1.06}.cuerpo{font-size:38px;line-height:1.5;color:rgba(245,255,240,.8);max-width:860px}.cta{font-size:34px;font-weight:700;color:#0c0c0e;background:{{acento}};border-radius:999px;padding:22px 60px}` } }, position: { x: 400, y: 440 } },
      { id: "tpl_gracias", type: "template", label: "Post gracias (receta)", config: { format: "post", maxItems: 1, recipe: { width: 1080, height: 1350, background: "#0c0c0e", html: `<main>\n  <span class="kicker">{{evento}}</span>\n  <h1>Gracias por acompañarnos</h1>\n  <p class="cuerpo">Nos vemos en la próxima edición. Las fotos y grabaciones llegan esta semana.</p>\n  <div class="fecha">{{fecha}} · {{ciudad}}</div>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;justify-items:center;gap:40px;padding:90px;text-align:center;background:radial-gradient(120% 90% at 50% 100%,#1c2a1e 0%,#0c0c0e 60%);color:#f5fff0;font-family:Georgia,serif}.kicker{font-size:26px;letter-spacing:8px;text-transform:uppercase;color:{{acento}}}h1{font-size:100px;line-height:1.06;max-width:860px}.cuerpo{font-size:36px;line-height:1.5;color:rgba(245,255,240,.8);max-width:820px}.fecha{font-size:34px;color:{{acento}}}` } }, position: { x: 400, y: 640 } },
      { id: "tpl_fotocheck", type: "template", label: "Fotocheck (receta)", config: { format: "custom", maxItems: 1, recipe: { width: 750, height: 1200, background: "#f7f7f4", html: `<main>\n  <span class="kicker">{{evento}}</span>\n  <div class="rol">PONENTE</div>\n  <h1>{{marca}}</h1>\n  <div class="fecha">{{fecha}} · {{ciudad}}</div>\n  <div class="banda"></div>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;gap:34px;padding:70px;background:#f7f7f4;color:#101014;font-family:Arial,sans-serif;text-align:center}.kicker{font-size:24px;letter-spacing:6px;text-transform:uppercase;color:#666}.rol{justify-self:center;font-size:30px;font-weight:800;letter-spacing:4px;color:#101014;background:{{acento}};border-radius:10px;padding:12px 34px}h1{font-size:64px;line-height:1.1}.fecha{font-size:28px;color:#555}.banda{position:fixed;bottom:0;left:0;right:0;height:26px;background:{{acento}}}` } }, position: { x: 400, y: 840 } },
      { id: "merge1", type: "merge", label: "Juntar kit", config: { mode: "append" }, position: { x: 740, y: 440 } },
      { id: "prev1", type: "preview", label: "Ver el kit", config: { title: "Kit de evento" }, position: { x: 1020, y: 440 } },
    ],
    edges: [
      { from: "map1", to: "tpl_inscribete" }, { from: "map1", to: "tpl_countdown" }, { from: "map1", to: "tpl_ponentes" }, { from: "map1", to: "tpl_gracias" }, { from: "map1", to: "tpl_fotocheck" },
      { from: "tpl_inscribete", to: "merge1" }, { from: "tpl_countdown", to: "merge1" }, { from: "tpl_ponentes", to: "merge1" }, { from: "tpl_gracias", to: "merge1" }, { from: "tpl_fotocheck", to: "merge1" },
      { from: "merge1", to: "prev1" },
    ],
  },
  {
    id: "preset_calendario_mes",
    name: "Grilla del mes: 5 ideas por run (receta viva)",
    description: "Marca, tema del mes y fecha inicial: la IA divide el tema en 5 ideas publicables (fecha, formato, gancho) y viste una card por idea. El engine acepta 5 renders por corrida — repite el flow con otro enfoque para cubrir las semanas siguientes.",
    trigger: { type: "manual" },
    inputs: [
      { key: "marca", label: "Marca", type: "text", required: true, default: "Café Borja" },
      { key: "tema", label: "Tema del mes", type: "text", required: true, default: "cultura cafetera y nuevos métodos" },
      { key: "fechaInicio", label: "Primera fecha", type: "date", required: true, default: "2026-11-02" },
      { key: "tono", label: "Tono o notas de marca", type: "textarea", required: false, default: "cercano y educativo, sin tecnicismos" },
    ],
    nodes: [
      { id: "map1", type: "map", label: "Brief", config: { value: { marca: "{{input.marca}}", tema: "{{input.tema}}", fechaInicio: "{{input.fechaInicio}}", tono: "{{input.tono}}" } }, position: { x: 40, y: 120 } },
      { id: "ai1", type: "ai", label: "Planifica 5 ideas", config: { provider: "openrouter", model: "", credentialId: null, responseFormat: "json", systemPrompt: "Eres planner de contenidos. Con el brief divides el tema en 5 ideas publicables con ángulos distintos (educación, detrás de cámaras, prueba social, oferta, comunidad). Responde SOLO un JSON array (sin texto extra ni fences) con 5 objetos: {\"fecha\": \"YYYY-MM-DD\" (días salteados desde la fecha inicial), \"tema\": el subtema en máx 6 palabras, \"formato\": \"post\" | \"story\" | \"reel\", \"gancho\": máx 60 caracteres}. Español neutro.", prompt: "Marca: {{steps.map1.marca}}\nTema del mes: {{steps.map1.tema}}\nPrimera fecha: {{steps.map1.fechaInicio}}\nTono / notas: {{steps.map1.tono}}", maxOutputTokens: 1_200, schema: { type: "array", items: { type: "object", required: ["fecha", "tema", "formato", "gancho"], properties: { fecha: { type: "string" }, tema: { type: "string" }, formato: { type: "string" }, gancho: { type: "string" } } } } }, position: { x: 360, y: 120 } },
      { id: "map2", type: "map", label: "Aplanar ideas", config: { value: "{{steps.ai1.json}}" }, position: { x: 700, y: 120 } },
      { id: "tpl1", type: "template", label: "Card por idea (receta)", config: { format: "post", maxItems: 5, recipe: { width: 1080, height: 1350, background: "#101014", html: `<main>\n  <span class="kicker">{{fecha}} · {{formato}}</span>\n  <h1>{{gancho}}</h1>\n  <p class="tema">{{tema}}</p>\n  <footer>Idea del mes</footer>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;grid-template-rows:auto 1fr auto auto;gap:40px;align-content:center;padding:88px;background:radial-gradient(120% 100% at 50% 0%,#161c2c 0%,#101014 60%);color:#f5f5f7;font-family:Georgia,serif}.kicker{font-size:24px;letter-spacing:6px;text-transform:uppercase;color:#7dd3fc}h1{font-size:88px;line-height:1.06}.tema{font-size:36px;color:rgba(245,245,247,.8);max-width:860px}footer{font-size:28px;color:rgba(245,245,247,.5)}` } }, position: { x: 1040, y: 120 } },
      { id: "prev1", type: "preview", label: "Ver la grilla", config: { title: "Grilla del mes" }, position: { x: 1380, y: 120 } },
    ],
    edges: [
      { from: "map1", to: "ai1" }, { from: "ai1", to: "map2" }, { from: "map2", to: "tpl1" }, { from: "tpl1", to: "prev1" },
    ],
  },
  {
    id: "preset_carrito_abandonado",
    name: "Carrito abandonado: 3 emails (receta viva)",
    description: "La secuencia clásica de recuperación: la IA escribe los 3 emails (1 h, 24 h y 72 h) con asunto, preheader, cuerpo y CTA, y el flow viste UNA pieza de email por paso. Todo queda en la vista previa para copiarlo a tu herramienta de envíos.",
    trigger: { type: "manual" },
    inputs: [
      { key: "marca", label: "Marca", type: "text", required: true, default: "Tostiexpress" },
      { key: "producto", label: "Producto", type: "text", required: true, default: "cafetera Barista Pro" },
      { key: "descuento", label: "Descuento de cierre", type: "text", required: false, default: "10%" },
      { key: "colorPrimario", label: "Color de marca (hex)", type: "text", required: false, default: "#6366f1" },
    ],
    nodes: [
      { id: "map1", type: "map", label: "Brief", config: { value: { marca: "{{input.marca}}", producto: "{{input.producto}}", descuento: "{{input.descuento}}" } }, position: { x: 40, y: 120 } },
      { id: "ai1", type: "ai", label: "Secuencia de 3 emails", config: { provider: "openrouter", model: "", credentialId: null, responseFormat: "json", systemPrompt: "Eres email marketer. Escribe la secuencia de carrito abandonado en 3 pasos: 1 h (recordatorio amable), 24 h (prueba social + objeciones) y 72 h (cierre con el descuento dado). Responde SOLO un JSON array (sin texto extra ni fences) con EXACTAMENTE 3 objetos: {\"marca\": la marca tal cual, \"paso\": \"1 h\" | \"24 h\" | \"72 h\", \"asunto\": máx 50 caracteres, \"preheader\": máx 90 caracteres, \"cuerpo\": 2-3 frases, \"cta\": máx 24 caracteres}. Español neutro.", prompt: "Marca: {{steps.map1.marca}}\nProducto: {{steps.map1.producto}}\nDescuento de cierre: {{steps.map1.descuento}}", maxOutputTokens: 1_200, schema: { type: "array", items: { type: "object", required: ["marca", "paso", "asunto", "preheader", "cuerpo", "cta"], properties: { marca: { type: "string" }, paso: { type: "string" }, asunto: { type: "string" }, preheader: { type: "string" }, cuerpo: { type: "string" }, cta: { type: "string" } } } } }, position: { x: 360, y: 120 } },
      { id: "map2", type: "map", label: "Aplanar emails", config: { value: "{{steps.ai1.json}}" }, position: { x: 700, y: 120 } },
      { id: "tpl1", type: "template", label: "Email por paso (receta)", config: { format: "custom", maxItems: 3, recipe: { width: 600, height: 800, background: "#ffffff", html: `<main>\n  <header><span class="logo">{{marca}}</span><span class="paso">{{paso}}</span></header>\n  <h1>{{asunto}}</h1>\n  <p class="pre">{{preheader}}</p>\n  <p class="cuerpo">{{cuerpo}}</p>\n  <div class="cta">{{cta}}</div>\n  <footer>{{producto}}</footer>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:space-between;padding:52px;background:#ffffff;color:#14141c;font-family:Arial,sans-serif}header{display:flex;justify-content:space-between;align-items:center}.logo{font-size:28px;font-weight:800;color:{{colorPrimario}}}.paso{font-size:20px;color:#888;border:2px solid #eee;border-radius:999px;padding:6px 20px}h1{font-size:48px;line-height:1.15}.pre{font-size:24px;color:#777}.cuerpo{font-size:28px;line-height:1.55;color:#333}.cta{justify-self:start;font-size:28px;font-weight:700;color:#fff;background:{{colorPrimario}};border-radius:12px;padding:20px 44px}footer{font-size:22px;color:#999}` } }, position: { x: 1040, y: 120 } },
      { id: "prev1", type: "preview", label: "Ver los emails", config: { title: "Carrito abandonado" }, position: { x: 1380, y: 120 } },
    ],
    edges: [
      { from: "map1", to: "ai1" }, { from: "ai1", to: "map2" }, { from: "map2", to: "tpl1" }, { from: "tpl1", to: "prev1" },
    ],
  },
  {
    id: "preset_winback",
    name: "Win-back 90-180 días: 3 emails (receta viva)",
    description: "Reactivación de clientes dormidos: la IA redacta la secuencia (día 90, 120 y 180) con incentivo escalonado y el flow viste un email por paso. Revisa la secuencia completa en la vista previa final.",
    trigger: { type: "manual" },
    inputs: [
      { key: "marca", label: "Marca", type: "text", required: true, default: "Tostiexpress" },
      { key: "producto", label: "Producto", type: "text", required: true, default: "café en grano de origen" },
      { key: "incentivo", label: "Incentivo de regreso", type: "text", required: false, default: "envío gratis en tu próximo pedido" },
    ],
    nodes: [
      { id: "map1", type: "map", label: "Brief", config: { value: { marca: "{{input.marca}}", producto: "{{input.producto}}", incentivo: "{{input.incentivo}}" } }, position: { x: 40, y: 120 } },
      { id: "ai1", type: "ai", label: "Secuencia win-back", config: { provider: "openrouter", model: "", credentialId: null, responseFormat: "json", systemPrompt: "Eres email marketer. Escribe la secuencia de reactivación para clientes que no compran hace 3 a 6 meses: día 90 (te extrañamos + novedades), día 120 (incentivo del brief) y día 180 (última chance + baja fácil). Responde SOLO un JSON array (sin texto extra ni fences) con EXACTAMENTE 3 objetos: {\"marca\": la marca tal cual, \"paso\": \"Día 90\" | \"Día 120\" | \"Día 180\", \"asunto\": máx 50 caracteres, \"preheader\": máx 90 caracteres, \"cuerpo\": 2-3 frases, \"cta\": máx 24 caracteres}. Español neutro.", prompt: "Marca: {{steps.map1.marca}}\nProducto: {{steps.map1.producto}}\nIncentivo: {{steps.map1.incentivo}}", maxOutputTokens: 1_200, schema: { type: "array", items: { type: "object", required: ["marca", "paso", "asunto", "preheader", "cuerpo", "cta"], properties: { marca: { type: "string" }, paso: { type: "string" }, asunto: { type: "string" }, preheader: { type: "string" }, cuerpo: { type: "string" }, cta: { type: "string" } } } } }, position: { x: 360, y: 120 } },
      { id: "map2", type: "map", label: "Aplanar emails", config: { value: "{{steps.ai1.json}}" }, position: { x: 700, y: 120 } },
      { id: "tpl1", type: "template", label: "Email por paso (receta)", config: { format: "custom", maxItems: 3, recipe: { width: 600, height: 800, background: "#ffffff", html: `<main>\n  <header><span class="logo">{{marca}}</span><span class="paso">{{paso}}</span></header>\n  <h1>{{asunto}}</h1>\n  <p class="pre">{{preheader}}</p>\n  <p class="cuerpo">{{cuerpo}}</p>\n  <div class="cta">{{cta}}</div>\n  <footer>{{producto}}</footer>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:space-between;padding:52px;background:#ffffff;color:#14141c;font-family:Arial,sans-serif}header{display:flex;justify-content:space-between;align-items:center}.logo{font-size:28px;font-weight:800;color:#0e7490}.paso{font-size:20px;color:#888;border:2px solid #eee;border-radius:999px;padding:6px 20px}h1{font-size:48px;line-height:1.15}.pre{font-size:24px;color:#777}.cuerpo{font-size:28px;line-height:1.55;color:#333}.cta{justify-self:start;font-size:28px;font-weight:700;color:#fff;background:#0e7490;border-radius:12px;padding:20px 44px}footer{font-size:22px;color:#999}` } }, position: { x: 1040, y: 120 } },
      { id: "prev1", type: "preview", label: "Ver los emails", config: { title: "Win-back" }, position: { x: 1380, y: 120 } },
    ],
    edges: [
      { from: "map1", to: "ai1" }, { from: "ai1", to: "map2" }, { from: "map2", to: "tpl1" }, { from: "tpl1", to: "prev1" },
    ],
  },
  {
    id: "preset_newsletter_email",
    name: "Newsletter semanal → email (receta viva)",
    description: "El RSS y una cuenta de X entran a la IA, que arma el asunto de la edición y 3 bloques (título + resumen); el flow viste un frame de email por bloque. Revisa la edición en la vista previa y envíala con tu herramienta favorita.",
    trigger: { type: "manual" },
    inputs: [
      { key: "marca", label: "Marca de la newsletter", type: "text", required: false, default: "El Vigía" },
    ],
    nodes: [
      { id: "rss1", type: "source_rss", label: "Feed 1", config: { url: "https://feeds.bbci.co.uk/mundo/rss.xml", limit: 8 }, position: { x: 40, y: 40 } },
      { id: "x1", type: "source_nitter", label: "Cuenta de X", config: { username: "usuario", instanceUrl: "https://nitter.net", limit: 10 }, position: { x: 40, y: 200 } },
      { id: "ai1", type: "ai", label: "Editor de la edición", config: { provider: "openrouter", model: "", credentialId: null, responseFormat: "json", systemPrompt: "Eres editor de newsletter. Con las noticias y posts de la semana, arma el asunto del email y 3 bloques. Responde SOLO un JSON array (sin texto extra ni fences) con EXACTAMENTE 3 objetos: {\"asunto\": el MISMO asunto en los 3 (máx 60 caracteres), \"titulo\": título del bloque (máx 50 caracteres), \"resumen\": 2 frases}. Español neutro, tono cercano.", prompt: "Entradas RSS de la semana: {{steps.rss1.items}}\nPosts de X de la semana: {{steps.x1.items}}", maxOutputTokens: 1_200, schema: { type: "array", items: { type: "object", required: ["asunto", "titulo", "resumen"], properties: { asunto: { type: "string" }, titulo: { type: "string" }, resumen: { type: "string" } } } } }, position: { x: 360, y: 120 } },
      { id: "map2", type: "map", label: "Aplanar bloques", config: { value: "{{steps.ai1.json}}" }, position: { x: 700, y: 120 } },
      { id: "tpl1", type: "template", label: "Email por bloque (receta)", config: { format: "custom", maxItems: 3, recipe: { width: 600, height: 900, background: "#ffffff", html: `<main>\n  <header><span class="logo">Newsletter semanal</span></header>\n  <h1>{{asunto}}</h1>\n  <div class="bloque"><span class="num">Bloque</span><h2>{{titulo}}</h2><p>{{resumen}}</p></div>\n  <footer>Lee la edición completa en el enlace</footer>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;grid-template-rows:auto auto 1fr auto;gap:32px;padding:52px;background:#ffffff;color:#14141c;font-family:Arial,sans-serif}header{border-bottom:4px solid #7c3aed;padding-bottom:20px}.logo{font-size:26px;font-weight:800;color:#7c3aed;text-transform:uppercase;letter-spacing:3px}h1{font-size:44px;line-height:1.15}.bloque{display:grid;gap:18px;align-content:start}.num{font-size:20px;letter-spacing:4px;text-transform:uppercase;color:#7c3aed}.bloque h2{font-size:36px;line-height:1.2}.bloque p{font-size:26px;line-height:1.55;color:#444}footer{font-size:22px;color:#999;border-top:2px solid #eee;padding-top:18px}` } }, position: { x: 1040, y: 120 } },
      { id: "prev1", type: "preview", label: "Ver la newsletter", config: { title: "Newsletter semanal" }, position: { x: 1380, y: 120 } },
    ],
    edges: [
      { from: "rss1", to: "ai1" }, { from: "x1", to: "ai1" },
      { from: "ai1", to: "map2" }, { from: "map2", to: "tpl1" }, { from: "tpl1", to: "prev1" },
    ],
  },
  {
    id: "preset_competitor_audit",
    name: "Auditoría de competencia (receta viva)",
    description: "La IA investiga en la web (webSearch nativo del proveedor) a tu competencia y arma 3 piezas: matriz SWOT, mapa de posicionamiento y resumen de hallazgos. Todo aterrizado en la vista previa final.",
    trigger: { type: "manual" },
    inputs: [
      { key: "tuMarca", label: "Tu marca", type: "text", required: true, default: "Café Borja" },
      { key: "competencia", label: "Competencia a auditar", type: "text", required: true, default: "Starbucks Perú" },
      { key: "foco", label: "Foco del análisis", type: "textarea", required: false, default: "experiencia en tienda, precios y app de fidelización" },
    ],
    nodes: [
      { id: "map1", type: "map", label: "Brief", config: { value: { tuMarca: "{{input.tuMarca}}", competencia: "{{input.competencia}}", foco: "{{input.foco}}" } }, position: { x: 40, y: 120 } },
      { id: "ai1", type: "ai", label: "Investiga la competencia", config: { provider: "openrouter", model: "", credentialId: null, webSearch: true, responseFormat: "json", systemPrompt: "Eres analista competitivo. Investiga en la web a la competencia y resume. Responde SOLO JSON con: resumen (3-4 líneas), fortalezas, debilidades, oportunidades y amenazas (cada una: 3 puntos cortos separados por ' · '), tuLugar y rivalLugar (posicionamiento calidad-precio en 4-8 palabras cada uno, español).", prompt: "Tu marca: {{steps.map1.tuMarca}}\nCompetencia: {{steps.map1.competencia}}\nFoco: {{steps.map1.foco}}", maxOutputTokens: 900, schema: { type: "object", required: ["resumen", "fortalezas", "debilidades", "oportunidades", "amenazas", "tuLugar", "rivalLugar"], properties: { resumen: { type: "string" }, fortalezas: { type: "string" }, debilidades: { type: "string" }, oportunidades: { type: "string" }, amenazas: { type: "string" }, tuLugar: { type: "string" }, rivalLugar: { type: "string" } } } }, position: { x: 360, y: 120 } },
      { id: "map2", type: "map", label: "Tokens de la auditoría", config: { value: { tuMarca: "{{input.tuMarca}}", competencia: "{{input.competencia}}", foco: "{{input.foco}}", resumen: "{{steps.ai1.json.resumen}}", fortalezas: "{{steps.ai1.json.fortalezas}}", debilidades: "{{steps.ai1.json.debilidades}}", oportunidades: "{{steps.ai1.json.oportunidades}}", amenazas: "{{steps.ai1.json.amenazas}}", tuLugar: "{{steps.ai1.json.tuLugar}}", rivalLugar: "{{steps.ai1.json.rivalLugar}}" } }, position: { x: 700, y: 120 } },
      { id: "tpl_swot", type: "template", label: "Matriz SWOT (receta)", config: { format: "post", maxItems: 1, recipe: { width: 1080, height: 1350, background: "#0c1220", html: `<main>\n  <span class="kicker">Auditoría · {{competencia}}</span>\n  <section class="swot">\n    <div class="q f"><h2>F</h2><p>{{fortalezas}}</p></div>\n    <div class="q d"><h2>D</h2><p>{{debilidades}}</p></div>\n    <div class="q o"><h2>O</h2><p>{{oportunidades}}</p></div>\n    <div class="q a"><h2>A</h2><p>{{amenazas}}</p></div>\n  </section>\n  <footer>{{tuMarca}}</footer>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;grid-template-rows:auto 1fr auto;gap:36px;padding:76px;background:#0c1220;color:#eef2ff;font-family:Arial,sans-serif}.kicker{font-size:24px;letter-spacing:5px;text-transform:uppercase;color:#38bdf8}.swot{display:grid;grid-template-columns:1fr 1fr;gap:22px}.q{border-radius:18px;padding:30px;display:grid;gap:16px;align-content:start}.q h2{font-size:52px}.q p{font-size:25px;line-height:1.55;color:rgba(238,242,255,.85)}.f{background:rgba(56,189,248,.12)}.d{background:rgba(248,113,113,.12)}.o{background:rgba(134,239,172,.12)}.a{background:rgba(250,204,21,.12)}footer{font-size:24px;color:rgba(238,242,255,.5)}` } }, position: { x: 1040, y: 40 } },
      { id: "tpl_mapa", type: "template", label: "Mapa de posicionamiento (receta)", config: { format: "post", maxItems: 1, recipe: { width: 1080, height: 1080, background: "#0c1220", html: `<main>\n  <span class="kicker">Mapa de posicionamiento</span>\n  <div class="mapa">\n    <div class="punto mio">Tu marca</div>\n    <div class="punto rival">Rival</div>\n  </div>\n  <p class="caption">Tú: {{tuLugar}}<br>Rival: {{rivalLugar}}</p>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;grid-template-rows:auto 1fr auto;gap:30px;padding:70px;background:#0c1220;color:#eef2ff;font-family:Arial,sans-serif}.kicker{font-size:24px;letter-spacing:5px;text-transform:uppercase;color:#38bdf8}.mapa{position:relative;border:2px solid rgba(238,242,255,.25);border-radius:24px;background:linear-gradient(rgba(238,242,255,.12) 1px,transparent 1px) 0 50%/100% 50% no-repeat,linear-gradient(90deg,rgba(238,242,255,.12) 1px,transparent 1px) 50% 0/50% 100% no-repeat}.punto{position:absolute;border-radius:999px;padding:18px 36px;font-size:26px;font-weight:700}.mio{top:24%;left:16%;background:#38bdf8;color:#0c1220}.rival{bottom:24%;right:16%;border:3px solid rgba(238,242,255,.6);color:#eef2ff}.caption{font-size:26px;line-height:1.6;color:rgba(238,242,255,.8)}` } }, position: { x: 1040, y: 240 } },
      { id: "tpl_resumen", type: "template", label: "Hallazgos (receta)", config: { format: "post", maxItems: 1, recipe: { width: 1080, height: 1350, background: "#0c1220", html: `<main>\n  <span class="kicker">Hallazgos · {{competencia}}</span>\n  <p class="resumen">{{resumen}}</p>\n  <div class="foco"><span>Foco del análisis</span><p>{{foco}}</p></div>\n  <footer>{{tuMarca}}</footer>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;gap:48px;padding:84px;background:#0c1220;color:#eef2ff;font-family:Arial,sans-serif}.kicker{font-size:24px;letter-spacing:5px;text-transform:uppercase;color:#38bdf8}.resumen{font-size:40px;line-height:1.55;color:rgba(238,242,255,.92);max-width:880px}.foco{display:grid;gap:14px;border-left:5px solid #38bdf8;padding-left:30px}.foco span{font-size:20px;letter-spacing:3px;text-transform:uppercase;color:rgba(238,242,255,.5)}.foco p{font-size:28px;color:rgba(238,242,255,.8)}footer{font-size:24px;color:rgba(238,242,255,.5)}` } }, position: { x: 1040, y: 440 } },
      { id: "merge1", type: "merge", label: "Juntar piezas", config: { mode: "append" }, position: { x: 1400, y: 240 } },
      { id: "prev1", type: "preview", label: "Ver la auditoría", config: { title: "Auditoría de competencia" }, position: { x: 1680, y: 240 } },
    ],
    edges: [
      { from: "map1", to: "ai1" }, { from: "ai1", to: "map2" },
      { from: "map2", to: "tpl_swot" }, { from: "map2", to: "tpl_mapa" }, { from: "map2", to: "tpl_resumen" },
      { from: "tpl_swot", to: "merge1" }, { from: "tpl_mapa", to: "merge1" }, { from: "tpl_resumen", to: "merge1" },
      { from: "merge1", to: "prev1" },
    ],
  },
  {
    id: "preset_propuesta_comercial",
    name: "Propuesta comercial: portada + fases (receta viva)",
    description: "Cliente, servicio, precio y plazo entran; sale la propuesta: portada con el resumen de la IA, una card por fase con semanas y entregables, y cierre con inversión y llamado a arrancar. Lo revisas todo en la vista previa antes de enviarlo.",
    trigger: { type: "manual" },
    inputs: [
      { key: "cliente", label: "Cliente", type: "text", required: true, default: "Pollería La Braza" },
      { key: "servicio", label: "Servicio a proponer", type: "text", required: true, default: "identidad de marca y kit de redes" },
      { key: "precio", label: "Precio / inversión", type: "text", required: true, default: "S/ 4,800" },
      { key: "plazo", label: "Plazo (p. ej. 6 semanas)", type: "text", required: true, default: "6 semanas" },
      { key: "tuNombre", label: "Tu nombre o agencia", type: "text", required: false, default: "Estudio Futuraria" },
    ],
    nodes: [
      { id: "map1", type: "map", label: "Brief", config: { value: { cliente: "{{input.cliente}}", servicio: "{{input.servicio}}", precio: "{{input.precio}}", plazo: "{{input.plazo}}", tuNombre: "{{input.tuNombre}}" } }, position: { x: 40, y: 200 } },
      { id: "ai1", type: "ai", label: "Estructura la propuesta", config: { provider: "openrouter", model: "", credentialId: null, responseFormat: "json", systemPrompt: "Eres account manager. Con el encargo, escribes el resumen ejecutivo y divides el trabajo en 3 o 4 fases. Responde SOLO JSON con: resumen (2-3 frases, español) y fases (array de objetos: fase en máx 4 palabras, semanas como número en texto — p. ej. \"2\" — y entregable en una frase).", prompt: "Cliente: {{steps.map1.cliente}}\nServicio: {{steps.map1.servicio}}\nPrecio: {{steps.map1.precio}}\nPlazo: {{steps.map1.plazo}}", maxOutputTokens: 700, schema: { type: "object", required: ["resumen", "fases"], properties: { resumen: { type: "string" }, fases: { type: "array", items: { type: "object", required: ["fase", "semanas", "entregable"], properties: { fase: { type: "string" }, semanas: { type: "string" }, entregable: { type: "string" } } } } } } }, position: { x: 360, y: 200 } },
      { id: "map2", type: "map", label: "Tokens de la propuesta", config: { value: { cliente: "{{input.cliente}}", servicio: "{{input.servicio}}", precio: "{{input.precio}}", plazo: "{{input.plazo}}", tuNombre: "{{input.tuNombre}}", resumen: "{{steps.ai1.json.resumen}}" } }, position: { x: 700, y: 40 } },
      { id: "map3", type: "map", label: "Aplanar fases", config: { value: "{{steps.ai1.json.fases}}" }, position: { x: 700, y: 440 } },
      { id: "tpl_portada", type: "template", label: "Portada (receta)", config: { format: "post", maxItems: 1, recipe: { width: 1080, height: 1350, background: "#101014", html: `<main>\n  <span class="kicker">Propuesta comercial</span>\n  <h1>{{servicio}}</h1>\n  <p class="cliente">Para {{cliente}}</p>\n  <p class="resumen">{{resumen}}</p>\n  <footer><span>{{tuNombre}}</span><span>{{plazo}}</span></footer>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;gap:40px;padding:90px;background:radial-gradient(120% 90% at 50% 0%,#1b2340 0%,#101014 60%);color:#fff;font-family:'Helvetica Neue',sans-serif}.kicker{font-size:24px;letter-spacing:6px;text-transform:uppercase;color:#818cf8}h1{font-size:100px;line-height:1.05;max-width:880px}.cliente{font-size:42px;color:rgba(255,255,255,.85)}.resumen{font-size:30px;line-height:1.55;color:rgba(255,255,255,.7);max-width:860px}footer{display:flex;justify-content:space-between;font-size:26px;color:rgba(255,255,255,.5);border-top:1px solid rgba(255,255,255,.16);padding-top:26px}` } }, position: { x: 1040, y: 40 } },
      { id: "tpl_fases", type: "template", label: "Fase por fase (receta)", config: { format: "post", maxItems: 5, recipe: { width: 1080, height: 1350, background: "#101014", html: `<main>\n  <span class="kicker">Fase</span>\n  <h1>{{fase}}</h1>\n  <div class="semanas">{{semanas}} semanas</div>\n  <p class="entregable">{{entregable}}</p>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;justify-items:start;gap:40px;padding:90px;background:radial-gradient(120% 90% at 0% 0%,#1b2340 0%,#101014 60%);color:#fff;font-family:'Helvetica Neue',sans-serif}.kicker{font-size:24px;letter-spacing:6px;text-transform:uppercase;color:#818cf8}h1{font-size:110px;line-height:1.05;max-width:860px}.semanas{font-size:38px;font-weight:700;color:#818cf8;border:3px solid #818cf8;border-radius:999px;padding:16px 48px}.entregable{font-size:34px;line-height:1.5;color:rgba(255,255,255,.78);max-width:860px}` } }, position: { x: 1040, y: 440 } },
      { id: "tpl_cierre", type: "template", label: "Cierre (receta)", config: { format: "post", maxItems: 1, recipe: { width: 1080, height: 1350, background: "#101014", html: `<main>\n  <span class="kicker">Inversión y siguientes pasos</span>\n  <div class="precio">{{precio}}</div>\n  <p class="plazo">{{plazo}}</p>\n  <div class="cta">Arrancamos</div>\n  <footer>{{tuNombre}} · {{cliente}}</footer>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;justify-items:center;gap:38px;padding:90px;text-align:center;background:radial-gradient(120% 90% at 50% 100%,#1b2340 0%,#101014 60%);color:#fff;font-family:'Helvetica Neue',sans-serif}.kicker{font-size:24px;letter-spacing:6px;text-transform:uppercase;color:#818cf8}.precio{font-size:130px;font-weight:800;line-height:1}.plazo{font-size:38px;color:rgba(255,255,255,.8)}.cta{font-size:34px;font-weight:700;color:#101014;background:#818cf8;border-radius:999px;padding:22px 64px}footer{font-size:26px;color:rgba(255,255,255,.5)}` } }, position: { x: 1040, y: 640 } },
      { id: "merge1", type: "merge", label: "Juntar propuesta", config: { mode: "append" }, position: { x: 1400, y: 340 } },
      { id: "prev1", type: "preview", label: "Ver la propuesta", config: { title: "Propuesta comercial" }, position: { x: 1680, y: 340 } },
    ],
    edges: [
      { from: "map1", to: "ai1" }, { from: "ai1", to: "map2" }, { from: "ai1", to: "map3" },
      { from: "map2", to: "tpl_portada" }, { from: "map2", to: "tpl_cierre" }, { from: "map3", to: "tpl_fases" },
      { from: "tpl_portada", to: "merge1" }, { from: "tpl_fases", to: "merge1" }, { from: "tpl_cierre", to: "merge1" },
      { from: "merge1", to: "prev1" },
    ],
  },
  {
    id: "preset_food_delivery",
    name: "Food delivery: kit esencial (receta viva)",
    description: "Sin IA y al instante: mini manual de identidad, post de producto, sticker de packaging, arte de bolsa y story de promo, con tus colores. Las 5 piezas quedan en la vista previa final.",
    trigger: { type: "manual" },
    inputs: [
      { key: "marca", label: "Marca", type: "text", required: true, default: "La Braza" },
      { key: "plato", label: "Plato estrella", type: "text", required: true, default: "pollo a la brasa familiar" },
      { key: "promo", label: "Promoción", type: "text", required: false, default: "2x1 en tu primer pedido" },
      { key: "colorPrimario", label: "Color primario (hex)", type: "text", required: false, default: "#f97316" },
      { key: "colorFondo", label: "Color de fondo (hex)", type: "text", required: false, default: "#1c1006" },
    ],
    nodes: [
      { id: "map1", type: "map", label: "Datos del kit", config: { value: { marca: "{{input.marca}}", plato: "{{input.plato}}", promo: "{{input.promo}}", colorPrimario: "{{input.colorPrimario}}", colorFondo: "{{input.colorFondo}}" } }, position: { x: 40, y: 440 } },
      { id: "tpl_manual", type: "template", label: "Mini manual (receta)", config: { format: "post", maxItems: 1, recipe: { width: 1080, height: 1350, background: "#1c1006", html: `<main>\n  <span class="kicker">Identidad · food delivery</span>\n  <div class="logo">{{marca}}</div>\n  <section class="swatches">\n    <div class="chip"><i style="background:{{colorPrimario}}"></i><span>Primario</span><code>{{colorPrimario}}</code></div>\n    <div class="chip"><i style="background:{{colorFondo}};border:1px solid rgba(255,255,255,.25)"></i><span>Fondo</span><code>{{colorFondo}}</code></div>\n  </section>\n  <p class="firma">Plato estrella: {{plato}}</p>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;gap:44px;padding:84px;background:radial-gradient(120% 90% at 50% 0%,rgba(255,255,255,.06) 0%,transparent 55%),{{colorFondo}};color:#fff;font-family:Arial,sans-serif}.kicker{font-size:22px;letter-spacing:5px;text-transform:uppercase;color:{{colorPrimario}}}.logo{font-size:120px;font-weight:900;line-height:1;color:{{colorPrimario}}}.swatches{display:grid;grid-template-columns:repeat(2,1fr);gap:24px}.chip{border:1px solid rgba(255,255,255,.16);border-radius:18px;padding:24px;display:grid;gap:12px}.chip i{display:block;height:90px;border-radius:12px}.chip span{font-size:19px;color:rgba(255,255,255,.6)}code{font-size:22px}.firma{font-size:30px;color:rgba(255,255,255,.75)}` } }, position: { x: 400, y: 40 } },
      { id: "tpl_social", type: "template", label: "Post producto (receta)", config: { format: "post", maxItems: 1, recipe: { width: 1080, height: 1350, background: "#1c1006", html: `<main>\n  <span class="kicker">{{marca}}</span>\n  <h1>{{plato}}</h1>\n  <p class="firma">Hecho hoy, caliente en minutos.</p>\n  <div class="cta">Pide por la app</div>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;justify-items:center;gap:40px;padding:90px;text-align:center;background:radial-gradient(120% 90% at 50% 0%,rgba(255,255,255,.07) 0%,transparent 55%),{{colorFondo}};color:#fff;font-family:Georgia,serif}.kicker{font-size:26px;letter-spacing:7px;text-transform:uppercase;color:{{colorPrimario}}}h1{font-size:120px;line-height:1.05;max-width:840px}.firma{font-size:38px;color:rgba(255,255,255,.78)}.cta{font-size:34px;font-weight:700;color:{{colorFondo}};background:{{colorPrimario}};border-radius:999px;padding:22px 60px}` } }, position: { x: 400, y: 240 } },
      { id: "tpl_packaging", type: "template", label: "Sticker packaging (receta)", config: { format: "post", maxItems: 1, recipe: { width: 1080, height: 1080, background: "#1c1006", html: `<main>\n  <div class="sello"><span>{{marca}}</span><em>{{plato}}</em></div>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;place-items:center;background:{{colorFondo}}}.sello{width:640px;height:640px;border-radius:50%;border:6px dashed {{colorPrimario}};display:grid;align-content:center;justify-items:center;gap:24px;text-align:center;padding:60px}.sello span{font-size:88px;font-weight:900;color:{{colorPrimario}};font-family:Arial,sans-serif}.sello em{font-size:32px;color:rgba(255,255,255,.8);font-family:Georgia,serif}` } }, position: { x: 400, y: 440 } },
      { id: "tpl_bolsa", type: "template", label: "Bolsa delivery (receta)", config: { format: "post", maxItems: 1, recipe: { width: 1080, height: 1350, background: "{{colorPrimario}}", html: `<main>\n  <div class="logo">{{marca}}</div>\n  <p class="frase">¡Tu pedido va en camino!</p>\n  <footer>{{plato}} te espera caliente</footer>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;justify-items:center;gap:44px;padding:90px;text-align:center;background:{{colorPrimario}};color:{{colorFondo}};font-family:Arial,sans-serif}.logo{font-size:130px;font-weight:900;line-height:1}.frase{font-size:52px;font-weight:700;font-family:Georgia,serif}footer{font-size:30px;opacity:.75}` } }, position: { x: 400, y: 640 } },
      { id: "tpl_promo", type: "template", label: "Story promo (receta)", config: { format: "story", maxItems: 1, recipe: { width: 1080, height: 1920, background: "#1c1006", html: `<main>\n  <span class="kicker">Solo por hoy</span>\n  <h1>{{promo}}</h1>\n  <div class="cta">Pide ahora</div>\n  <footer>{{marca}} · {{plato}}</footer>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;justify-items:center;gap:48px;padding:100px;text-align:center;background:radial-gradient(120% 80% at 50% 0%,rgba(255,255,255,.08) 0%,transparent 55%),{{colorFondo}};color:#fff;font-family:Georgia,serif}.kicker{font-size:28px;letter-spacing:8px;text-transform:uppercase;color:{{colorPrimario}}}h1{font-size:130px;line-height:1.06;max-width:840px}.cta{font-size:36px;font-weight:700;color:{{colorFondo}};background:{{colorPrimario}};border-radius:999px;padding:24px 68px}footer{position:fixed;bottom:70px;font-size:28px;color:rgba(255,255,255,.6)}` } }, position: { x: 400, y: 840 } },
      { id: "merge1", type: "merge", label: "Juntar kit", config: { mode: "append" }, position: { x: 740, y: 440 } },
      { id: "prev1", type: "preview", label: "Ver el kit", config: { title: "Food delivery" }, position: { x: 1020, y: 440 } },
    ],
    edges: [
      { from: "map1", to: "tpl_manual" }, { from: "map1", to: "tpl_social" }, { from: "map1", to: "tpl_packaging" }, { from: "map1", to: "tpl_bolsa" }, { from: "map1", to: "tpl_promo" },
      { from: "tpl_manual", to: "merge1" }, { from: "tpl_social", to: "merge1" }, { from: "tpl_packaging", to: "merge1" }, { from: "tpl_bolsa", to: "merge1" }, { from: "tpl_promo", to: "merge1" },
      { from: "merge1", to: "prev1" },
    ],
  },
  {
    id: "preset_restaurante_fisica",
    name: "Restaurante y cafetería: físico + digital (receta viva)",
    description: "Carta, tent card con QR, señalética de pedido, vaso y post de redes con la identidad de tu local. Cero IA y cero esperas: llena los datos y revisa el kit completo en la vista previa final.",
    trigger: { type: "manual" },
    inputs: [
      { key: "marca", label: "Marca del local", type: "text", required: true, default: "Café Borja" },
      { key: "plato", label: "Plato estrella", type: "text", required: true, default: "croissant de almendras" },
      { key: "horario", label: "Horario", type: "text", required: false, default: "Lun-Dom · 8 am - 10 pm" },
      { key: "acento", label: "Color de acento (hex)", type: "text", required: false, default: "#f59e0b" },
    ],
    nodes: [
      { id: "map1", type: "map", label: "Datos del local", config: { value: { marca: "{{input.marca}}", plato: "{{input.plato}}", horario: "{{input.horario}}", acento: "{{input.acento}}" } }, position: { x: 40, y: 440 } },
      { id: "tpl_carta", type: "template", label: "Carta (receta)", config: { format: "story", maxItems: 1, recipe: { width: 1080, height: 1920, background: "#141210", html: `<main>\n  <span class="kicker">Carta</span>\n  <h1>{{marca}}</h1>\n  <div class="estrella">Plato estrella: {{plato}}</div>\n  <footer>{{horario}}</footer>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;justify-items:center;gap:48px;padding:100px;text-align:center;background:radial-gradient(120% 80% at 50% 0%,rgba(245,158,11,.12) 0%,transparent 55%),#141210;color:#faf5ef;font-family:Georgia,serif}.kicker{font-size:28px;letter-spacing:9px;text-transform:uppercase;color:{{acento}}}h1{font-size:130px;line-height:1.05}.estrella{font-size:40px;color:rgba(250,245,239,.85);border:2px solid {{acento}};border-radius:999px;padding:20px 52px}footer{position:fixed;bottom:80px;font-size:28px;color:rgba(250,245,239,.6)}` } }, position: { x: 400, y: 40 } },
      { id: "tpl_qr", type: "template", label: "Tent card QR (receta)", config: { format: "post", maxItems: 1, recipe: { width: 1080, height: 1080, background: "#faf7f2", html: `<main>\n  <h1>Escanea la carta</h1>\n  <div class="qr"><i></i><i></i><i></i><i></i></div>\n  <p>Apunta tu cámara al código</p>\n  <footer>{{marca}}</footer>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;justify-items:center;gap:40px;padding:80px;text-align:center;background:#faf7f2;color:#1c1712;font-family:Georgia,serif}h1{font-size:72px}.qr{width:340px;height:340px;border:5px solid #1c1712;border-radius:20px;display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:22px}.qr i{background:repeating-linear-gradient(45deg,#1c1712 0 8px,transparent 8px 16px);border-radius:8px}p{font-size:30px;color:#6b5d4d}footer{font-size:26px;letter-spacing:4px;text-transform:uppercase;color:{{acento}}}` } }, position: { x: 400, y: 240 } },
      { id: "tpl_senaletica", type: "template", label: "Señalética (receta)", config: { format: "post", maxItems: 1, recipe: { width: 1080, height: 1350, background: "#141210", html: `<main>\n  <h1>Pide por QR<br>Retira en barra</h1>\n  <div class="paso">1 · Escanea — 2 · Ordena — 3 · Disfruta</div>\n  <footer>{{marca}} · {{horario}}</footer>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;justify-items:center;gap:52px;padding:90px;text-align:center;background:#141210;color:#faf5ef;font-family:Arial,sans-serif}h1{font-size:96px;line-height:1.15}.paso{font-size:36px;color:{{acento}};border:2px solid {{acento}};border-radius:999px;padding:20px 48px}footer{font-size:28px;color:rgba(250,245,239,.6)}` } }, position: { x: 400, y: 440 } },
      { id: "tpl_vaso", type: "template", label: "Vaso y empaques (receta)", config: { format: "post", maxItems: 1, recipe: { width: 1080, height: 1080, background: "#faf7f2", html: `<main>\n  <div class="taza"><span>{{marca}}</span></div>\n  <em>{{horario}}</em>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;justify-items:center;gap:40px;background:#faf7f2}.taza{width:560px;height:640px;background:{{acento}};border-radius:36px 36px 90px 90px;display:grid;place-items:center;box-shadow:inset 0 -28px 0 rgba(0,0,0,.12)}.taza span{font-size:64px;font-weight:900;color:#1c1712;text-align:center;padding:0 30px;font-family:Arial,sans-serif}em{font-size:28px;color:#6b5d4d;font-family:Georgia,serif}` } }, position: { x: 400, y: 640 } },
      { id: "tpl_instagram", type: "template", label: "Post redes (receta)", config: { format: "post", maxItems: 1, recipe: { width: 1080, height: 1350, background: "#141210", html: `<main>\n  <span class="kicker">Hoy en {{marca}}</span>\n  <h1>{{plato}}</h1>\n  <p class="firma">Reserva por DM · {{horario}}</p>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;justify-items:center;gap:44px;padding:90px;text-align:center;background:radial-gradient(120% 90% at 50% 100%,rgba(245,158,11,.14) 0%,transparent 55%),#141210;color:#faf5ef;font-family:Georgia,serif}.kicker{font-size:26px;letter-spacing:8px;text-transform:uppercase;color:{{acento}}}h1{font-size:130px;line-height:1.05;max-width:860px}.firma{font-size:36px;color:rgba(250,245,239,.75)}` } }, position: { x: 400, y: 840 } },
      { id: "merge1", type: "merge", label: "Juntar kit", config: { mode: "append" }, position: { x: 740, y: 440 } },
      { id: "prev1", type: "preview", label: "Ver el kit", config: { title: "Restaurante y cafetería" }, position: { x: 1020, y: 440 } },
    ],
    edges: [
      { from: "map1", to: "tpl_carta" }, { from: "map1", to: "tpl_qr" }, { from: "map1", to: "tpl_senaletica" }, { from: "map1", to: "tpl_vaso" }, { from: "map1", to: "tpl_instagram" },
      { from: "tpl_carta", to: "merge1" }, { from: "tpl_qr", to: "merge1" }, { from: "tpl_senaletica", to: "merge1" }, { from: "tpl_vaso", to: "merge1" }, { from: "tpl_instagram", to: "merge1" },
      { from: "merge1", to: "prev1" },
    ],
  },
  {
    id: "preset_campana_estacional",
    name: "Campaña estacional: BF, Navidad, más (receta viva)",
    description: "Key visual, post, story con fecha, banner web y email para Black Friday, Navidad, Fiestas Patrias o la campaña que quieras. Determinístico: sin key de IA y sin esperas; las 5 piezas quedan en la vista previa final.",
    trigger: { type: "manual" },
    inputs: [
      { key: "marca", label: "Marca", type: "text", required: true, default: "Tostiexpress" },
      { key: "campana", label: "Campaña", type: "text", required: false, default: "Black Friday" },
      { key: "fecha", label: "Fecha de cierre", type: "date", required: true, default: "2026-11-27" },
      { key: "descuento", label: "Descuento", type: "text", required: false, default: "-40%" },
      { key: "colorPrimario", label: "Color de campaña (hex)", type: "text", required: false, default: "#e11d48" },
    ],
    nodes: [
      { id: "map1", type: "map", label: "Datos de campaña", config: { value: { marca: "{{input.marca}}", campana: "{{input.campana}}", fecha: "{{input.fecha}}", descuento: "{{input.descuento}}", colorPrimario: "{{input.colorPrimario}}" } }, position: { x: 40, y: 440 } },
      { id: "tpl_keyvisual", type: "template", label: "Key visual (receta)", config: { format: "post", maxItems: 1, recipe: { width: 1080, height: 1350, background: "#180a10", html: `<main>\n  <span class="kicker">{{campana}}</span>\n  <h1>{{descuento}}</h1>\n  <p class="firma">Solo por tiempo limitado</p>\n  <footer>{{marca}} · hasta el {{fecha}}</footer>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;justify-items:center;gap:42px;padding:90px;text-align:center;background:radial-gradient(120% 90% at 50% 0%,rgba(225,29,72,.22) 0%,transparent 55%),#180a10;color:#fff;font-family:Arial,sans-serif}.kicker{font-size:30px;letter-spacing:10px;text-transform:uppercase;color:{{colorPrimario}}}h1{font-size:260px;font-weight:900;line-height:1;color:{{colorPrimario}}}.firma{font-size:38px;color:rgba(255,255,255,.8);font-family:Georgia,serif}footer{font-size:26px;color:rgba(255,255,255,.55)}` } }, position: { x: 400, y: 40 } },
      { id: "tpl_post", type: "template", label: "Post oferta (receta)", config: { format: "post", maxItems: 1, recipe: { width: 1080, height: 1350, background: "#180a10", html: `<main>\n  <span class="kicker">{{marca}} · {{campana}}</span>\n  <h1>Todo con {{descuento}}</h1>\n  <p class="firma">Hasta agotar stock. Corre la voz.</p>\n  <div class="cta">Compra aquí</div>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;justify-items:start;gap:44px;padding:90px;background:radial-gradient(120% 90% at 0% 0%,rgba(225,29,72,.18) 0%,transparent 55%),#180a10;color:#fff;font-family:Arial,sans-serif}.kicker{font-size:24px;letter-spacing:6px;text-transform:uppercase;color:{{colorPrimario}}}h1{font-size:104px;line-height:1.06}.firma{font-size:38px;color:rgba(255,255,255,.78);font-family:Georgia,serif}.cta{font-size:34px;font-weight:700;color:#180a10;background:{{colorPrimario}};border-radius:999px;padding:22px 60px}` } }, position: { x: 400, y: 240 } },
      { id: "tpl_story", type: "template", label: "Story countdown (receta)", config: { format: "story", maxItems: 1, recipe: { width: 1080, height: 1920, background: "#180a10", html: `<main>\n  <span class="kicker">Queda poco</span>\n  <h1>{{descuento}}</h1>\n  <div class="fecha">Hasta el {{fecha}}</div>\n  <div class="cta">Desliza hacia arriba</div>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;justify-items:center;gap:48px;padding:100px;text-align:center;background:radial-gradient(120% 80% at 50% 0%,rgba(225,29,72,.2) 0%,transparent 55%),#180a10;color:#fff;font-family:Arial,sans-serif}.kicker{font-size:28px;letter-spacing:9px;text-transform:uppercase;color:{{colorPrimario}}}h1{font-size:230px;font-weight:900;line-height:1;color:{{colorPrimario}}}.fecha{font-size:44px;font-weight:700;border:3px solid {{colorPrimario}};border-radius:999px;padding:18px 54px}.cta{font-size:32px;font-weight:700;color:#180a10;background:#fff;border-radius:999px;padding:22px 62px}` } }, position: { x: 400, y: 440 } },
      { id: "tpl_banner", type: "template", label: "Banner web (receta)", config: { format: "custom", maxItems: 1, recipe: { width: 1200, height: 628, background: "#180a10", html: `<main>\n  <div class="izq"><span class="kicker">{{campana}}</span><h1>{{descuento}}</h1></div>\n  <div class="der"><p>{{marca}}</p><div class="cta">Ver ofertas</div><span>Hasta el {{fecha}}</span></div>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;grid-template-columns:1.2fr 1fr;gap:40px;padding:60px;background:radial-gradient(120% 120% at 0% 50%,rgba(225,29,72,.25) 0%,transparent 60%),#180a10;color:#fff;font-family:Arial,sans-serif}.izq{display:grid;align-content:center;gap:18px}.kicker{font-size:20px;letter-spacing:6px;text-transform:uppercase;color:{{colorPrimario}}}.izq h1{font-size:130px;font-weight:900;line-height:1;color:{{colorPrimario}}}.der{display:grid;align-content:center;justify-items:start;gap:20px;border-left:2px solid rgba(255,255,255,.2);padding-left:40px}.der p{font-size:36px;font-weight:700}.cta{font-size:26px;font-weight:700;color:#180a10;background:{{colorPrimario}};border-radius:999px;padding:16px 40px}.der span{font-size:22px;color:rgba(255,255,255,.6)}` } }, position: { x: 400, y: 640 } },
      { id: "tpl_email", type: "template", label: "Email campaña (receta)", config: { format: "custom", maxItems: 1, recipe: { width: 600, height: 800, background: "#ffffff", html: `<main>\n  <header><span class="logo">{{marca}}</span><span class="tag">{{campana}}</span></header>\n  <h1>{{descuento}} en todo</h1>\n  <p class="cuerpo">Solo hasta el {{fecha}}. Aprovecha antes de que se agote.</p>\n  <div class="cta">Aprovechar ahora</div>\n  <footer>Ya no quieres estos correos? Responde "baja".</footer>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:space-between;padding:48px;background:#ffffff;color:#14141c;font-family:Arial,sans-serif}header{display:flex;justify-content:space-between;align-items:center}.logo{font-size:28px;font-weight:800;color:{{colorPrimario}}}.tag{font-size:20px;letter-spacing:3px;text-transform:uppercase;color:{{colorPrimario}};border:2px solid {{colorPrimario}};border-radius:999px;padding:6px 18px}h1{font-size:56px;line-height:1.1}.cuerpo{font-size:28px;line-height:1.55;color:#333}.cta{justify-self:start;font-size:28px;font-weight:700;color:#fff;background:{{colorPrimario}};border-radius:12px;padding:20px 44px}footer{font-size:20px;color:#999}` } }, position: { x: 400, y: 840 } },
      { id: "merge1", type: "merge", label: "Juntar campaña", config: { mode: "append" }, position: { x: 740, y: 440 } },
      { id: "prev1", type: "preview", label: "Ver la campaña", config: { title: "Campaña estacional" }, position: { x: 1020, y: 440 } },
    ],
    edges: [
      { from: "map1", to: "tpl_keyvisual" }, { from: "map1", to: "tpl_post" }, { from: "map1", to: "tpl_story" }, { from: "map1", to: "tpl_banner" }, { from: "map1", to: "tpl_email" },
      { from: "tpl_keyvisual", to: "merge1" }, { from: "tpl_post", to: "merge1" }, { from: "tpl_story", to: "merge1" }, { from: "tpl_banner", to: "merge1" }, { from: "tpl_email", to: "merge1" },
      { from: "merge1", to: "prev1" },
    ],
  },
  {
    id: "preset_onboarding_rrhh",
    name: "Contratación y bienvenida (receta viva)",
    description: "Post y story de vacante, banner de LinkedIn, fotocheck y post de bienvenida para quien se une al equipo. Sin IA y sin esperas: llena los datos y revisa el kit en la vista previa final.",
    trigger: { type: "manual" },
    inputs: [
      { key: "empresa", label: "Empresa", type: "text", required: true, default: "Futuraria" },
      { key: "puesto", label: "Puesto", type: "text", required: true, default: "Diseñador/a senior de producto" },
      { key: "nombre", label: "Nombre de quien se une", type: "text", required: false, default: "Renzo Pérez" },
      { key: "acento", label: "Color de acento (hex)", type: "text", required: false, default: "#38bdf8" },
    ],
    nodes: [
      { id: "map1", type: "map", label: "Datos", config: { value: { empresa: "{{input.empresa}}", puesto: "{{input.puesto}}", nombre: "{{input.nombre}}", acento: "{{input.acento}}" } }, position: { x: 40, y: 440 } },
      { id: "tpl_vacante_post", type: "template", label: "Post vacante (receta)", config: { format: "post", maxItems: 1, recipe: { width: 1080, height: 1350, background: "#0d1520", html: `<main>\n  <span class="kicker">Estamos contratando</span>\n  <h1>{{puesto}}</h1>\n  <p class="firma">Únete a {{empresa}}. Postula con tu CV o portafolio.</p>\n  <div class="cta">Postula ahora</div>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;justify-items:start;gap:44px;padding:90px;background:radial-gradient(120% 90% at 0% 0%,rgba(56,189,248,.14) 0%,transparent 55%),#0d1520;color:#f0f9ff;font-family:Arial,sans-serif}.kicker{font-size:24px;letter-spacing:6px;text-transform:uppercase;color:{{acento}}}h1{font-size:120px;line-height:1.05;max-width:860px}.firma{font-size:36px;line-height:1.5;color:rgba(240,249,255,.78);max-width:820px}.cta{font-size:34px;font-weight:700;color:#0d1520;background:{{acento}};border-radius:999px;padding:22px 60px}` } }, position: { x: 400, y: 40 } },
      { id: "tpl_vacante_story", type: "template", label: "Story vacante (receta)", config: { format: "story", maxItems: 1, recipe: { width: 1080, height: 1920, background: "#0d1520", html: `<main>\n  <span class="kicker">{{empresa}}</span>\n  <h1>Buscamos<br>{{puesto}}</h1>\n  <p class="firma">Desliza hacia arriba para postular</p>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;justify-items:center;gap:52px;padding:100px;text-align:center;background:radial-gradient(120% 80% at 50% 0%,rgba(56,189,248,.16) 0%,transparent 55%),#0d1520;color:#f0f9ff;font-family:Arial,sans-serif}.kicker{font-size:28px;letter-spacing:9px;text-transform:uppercase;color:{{acento}}}h1{font-size:150px;line-height:1.08}.firma{font-size:34px;color:rgba(240,249,255,.7)}` } }, position: { x: 400, y: 240 } },
      { id: "tpl_linkedin", type: "template", label: "Banner LinkedIn (receta)", config: { format: "custom", maxItems: 1, recipe: { width: 1200, height: 627, background: "#0d1520", html: `<main>\n  <span class="kicker">{{empresa}} · talento</span>\n  <h1>{{puesto}}</h1>\n  <p class="firma">Aplica hoy — enlace en la descripción</p>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;justify-items:start;gap:26px;padding:70px;background:radial-gradient(120% 140% at 100% 50%,rgba(56,189,248,.18) 0%,transparent 60%),#0d1520;color:#f0f9ff;font-family:Arial,sans-serif}.kicker{font-size:22px;letter-spacing:6px;text-transform:uppercase;color:{{acento}}}h1{font-size:96px;line-height:1.05}.firma{font-size:30px;color:rgba(240,249,255,.7)}` } }, position: { x: 400, y: 440 } },
      { id: "tpl_fotocheck", type: "template", label: "Fotocheck bienvenida (receta)", config: { format: "custom", maxItems: 1, recipe: { width: 750, height: 1200, background: "#f4f8fb", html: `<main>\n  <span class="kicker">{{empresa}}</span>\n  <div class="rol">EQUIPO</div>\n  <h1>{{nombre}}</h1>\n  <div class="puesto">{{puesto}}</div>\n  <div class="banda"></div>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;gap:34px;padding:70px;background:#f4f8fb;color:#0d1520;font-family:Arial,sans-serif;text-align:center}.kicker{font-size:24px;letter-spacing:6px;text-transform:uppercase;color:#64748b}.rol{justify-self:center;font-size:28px;font-weight:800;letter-spacing:4px;background:{{acento}};color:#0d1520;border-radius:10px;padding:12px 34px}h1{font-size:64px;line-height:1.1}.puesto{font-size:30px;color:#475569}.banda{position:fixed;bottom:0;left:0;right:0;height:26px;background:{{acento}}}` } }, position: { x: 400, y: 640 } },
      { id: "tpl_bienvenida", type: "template", label: "Post bienvenida (receta)", config: { format: "post", maxItems: 1, recipe: { width: 1080, height: 1350, background: "#0d1520", html: `<main>\n  <span class="kicker">Bienvenido/a</span>\n  <h1>{{nombre}}</h1>\n  <p class="firma">Nuevo/a {{puesto}} en {{empresa}}. ¡A romperla!</p>\n</main>`, css: `*{margin:0;box-sizing:border-box}main{width:100%;height:100vh;display:grid;align-content:center;justify-items:center;gap:44px;padding:90px;text-align:center;background:radial-gradient(120% 90% at 50% 100%,rgba(56,189,248,.16) 0%,transparent 55%),#0d1520;color:#f0f9ff;font-family:Arial,sans-serif}.kicker{font-size:26px;letter-spacing:8px;text-transform:uppercase;color:{{acento}}}h1{font-size:150px;line-height:1.05}.firma{font-size:38px;color:rgba(240,249,255,.78);max-width:820px}` } }, position: { x: 400, y: 840 } },
      { id: "merge1", type: "merge", label: "Juntar kit", config: { mode: "append" }, position: { x: 740, y: 440 } },
      { id: "prev1", type: "preview", label: "Ver el kit", config: { title: "Contratación y bienvenida" }, position: { x: 1020, y: 440 } },
    ],
    edges: [
      { from: "map1", to: "tpl_vacante_post" }, { from: "map1", to: "tpl_vacante_story" }, { from: "map1", to: "tpl_linkedin" }, { from: "map1", to: "tpl_fotocheck" }, { from: "map1", to: "tpl_bienvenida" },
      { from: "tpl_vacante_post", to: "merge1" }, { from: "tpl_vacante_story", to: "merge1" }, { from: "tpl_linkedin", to: "merge1" }, { from: "tpl_fotocheck", to: "merge1" }, { from: "tpl_bienvenida", to: "merge1" },
      { from: "merge1", to: "prev1" },
    ],
  },
  {
    id: "preset_blank",
    name: "Blank (canvas vacío)",
    description: "Empieza de cero: agrega fuentes, IA y templates con el editor o pidiéndoselo a tu IA.",
    trigger: { type: "manual" },
    nodes: [],
    edges: [],
  },
];

export function findFlowPreset(presetId: string): FlowPreset | undefined {
  return FLOW_LIBRARY.find((preset) => preset.id === presetId);
}
