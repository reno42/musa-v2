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
  trigger: { type: "manual" | "webhook" | "schedule"; cron?: string; timezone?: string } | null;
  nodes: FlowPresetNode[];
  edges: FlowPresetEdge[];
  /** Flows-brand: inputs declarados — el run los pide en el mini-form (UI) o
   *  en el payload (IA/webhook); executeFlow aplica defaults y required. */
  inputs?: FlowInputField[];
}

const REDACTAR_ES = "Eres editor de noticias. Recibes una noticia (título y resumen en su idioma original). Devuelve SOLO un resumen en español neutro, 2 frases máximo (280 caracteres), sin comillas ni prefijos. Tono informativo, sin clickbait.";

export const FLOW_LIBRARY: FlowPreset[] = [
  {
    id: "preset_noticias",
    name: "Noticias (RSS → carrusel)",
    description: "La bandera: 2 feeds RSS + IA que redacta en español + frames post y story de TU plantilla + reporte.",
    trigger: { type: "schedule", cron: "0 8 * * *", timezone: "America/Lima" },
    nodes: [
      { id: "rss1", type: "source_rss", label: "BBC Mundo", config: { url: "https://feeds.bbci.co.uk/mundo/rss.xml", limit: 10 }, position: { x: 40, y: 40 } },
      { id: "rss2", type: "source_rss", label: "DW Español", config: { url: "https://rss.dw.com/rdf/rss-sp-top", limit: 10 }, position: { x: 40, y: 200 } },
      { id: "ai1", type: "ai", label: "Redactor ES", config: { provider: "openrouter", model: "", credentialId: null, systemPrompt: REDACTAR_ES, prompt: "Noticia: {{item.title}} — {{item.summary}}", maxOutputTokens: 400, maxItems: 3 }, position: { x: 360, y: 120 } },
      { id: "post1", type: "template", label: "Frame post", config: { templateId: "", frameId: "", format: "post", maxItems: 3 }, position: { x: 700, y: 40 } },
      { id: "story1", type: "template", label: "Frame story", config: { templateId: "", frameId: "", format: "story", maxItems: 3 }, position: { x: 700, y: 220 } },
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
    description: "Feeds en inglés (TechCrunch + The Verge) → IA traduce y resume al español → carrusel con tus frames.",
    trigger: { type: "schedule", cron: "30 9 * * *", timezone: "America/Lima" },
    nodes: [
      { id: "rss1", type: "source_rss", label: "TechCrunch", config: { url: "https://techcrunch.com/feed/", limit: 10 }, position: { x: 40, y: 40 } },
      { id: "rss2", type: "source_rss", label: "The Verge", config: { url: "https://www.theverge.com/rss/index.xml", limit: 10 }, position: { x: 40, y: 200 } },
      { id: "ai1", type: "ai", label: "Traductor ES", config: { provider: "openrouter", model: "", credentialId: null, systemPrompt: "Traduce al español neutro y resume en 2 frases (máx 280 caracteres). Devuelve SOLO el resumen.", prompt: "Noticia: {{item.title}} — {{item.summary}}", maxOutputTokens: 400, maxItems: 3 }, position: { x: 360, y: 120 } },
      { id: "post1", type: "template", label: "Frame post", config: { templateId: "", frameId: "", format: "post", maxItems: 3 }, position: { x: 700, y: 120 } },
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
      { id: "rss1", type: "source_rss", label: "Blog competencia", config: { url: "https://example.com/feed.xml", limit: 10 }, position: { x: 40, y: 40 } },
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
    description: "Cuenta de X vía Nitter → IA convierte en takes de opinión con tu voz → frame post.",
    trigger: { type: "manual" },
    nodes: [
      { id: "x1", type: "source_nitter", label: "Cuenta X", config: { username: "usuario", instanceUrl: "https://nitter.net", limit: 10 }, position: { x: 40, y: 120 } },
      { id: "ai1", type: "ai", label: "Hot take", config: { provider: "openrouter", model: "", credentialId: null, systemPrompt: "Convierte la noticia en un take de opinión corto, directo y con personalidad (máx 220 caracteres). Sin hashtags.", prompt: "Post: {{item.title}} — {{item.summary}}", maxOutputTokens: 300, maxItems: 3 }, position: { x: 360, y: 120 } },
      { id: "post1", type: "template", label: "Frame post", config: { templateId: "", frameId: "", format: "post", maxItems: 3 }, position: { x: 700, y: 120 } },
    ],
    edges: [ { from: "x1", to: "ai1" }, { from: "ai1", to: "post1" } ],
  },
  {
    id: "preset_monitor_precio",
    name: "Monitor de precio/API",
    description: "Consulta una API JSON, compara contra un umbral y avisa (POST a tu webhook) solo cuando se pasa.",
    trigger: { type: "schedule", cron: "*/30 * * * *", timezone: "America/Lima" },
    nodes: [
      { id: "src1", type: "source_http", label: "API de precio", config: { url: "https://api.example.com/v1/price", listPath: "data", limit: 5 }, position: { x: 40, y: 120 } },
      { id: "cond1", type: "condition", label: "¿Pasó el umbral?", config: { path: "item.price", operator: "greater_than", value: 100 }, position: { x: 360, y: 120 } },
      { id: "hook1", type: "http", label: "Avisar webhook", config: { url: "https://hooks.example.com/flow-alert", method: "POST", body: { text: "Umbral pasado: {{item.price}}" } }, position: { x: 700, y: 40 } },
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
    name: "SEO/Geo: 3 variantes de post",
    description: "Una keyword → IA genera título y descripción → 3 variantes de post con tus frames.",
    trigger: { type: "manual" },
    nodes: [
      { id: "map1", type: "map", label: "Keyword", config: { value: { keyword: "cursos de diseño lima", ciudad: "Lima" } }, position: { x: 40, y: 120 } },
      { id: "ai1", type: "ai", label: "Copy SEO", config: { provider: "openrouter", model: "", credentialId: null, systemPrompt: "Eres especialista SEO local. Dado keyword y ciudad, devuelve: un título (máx 60 caracteres) y una descripción (máx 155 caracteres). Formato: TITULO: ... | DESCRIPCION: ...", prompt: "Keyword: {{steps.map1.keyword}} — Ciudad: {{steps.map1.ciudad}}", maxOutputTokens: 300 }, position: { x: 360, y: 120 } },
      { id: "post1", type: "template", label: "Variante A", config: { templateId: "", frameId: "", format: "post", maxItems: 1 }, position: { x: 700, y: 40 } },
      { id: "post2", type: "template", label: "Variante B", config: { templateId: "", frameId: "", format: "post", maxItems: 1 }, position: { x: 700, y: 200 } },
    ],
    edges: [ { from: "map1", to: "ai1" }, { from: "ai1", to: "post1" }, { from: "ai1", to: "post2" } ],
  },
  {
    id: "preset_testimonio",
    name: "Testimonio → card quote",
    description: "Pega un testimonio (map) → tu frame tipo quote lo convierte en pieza lista para publicar.",
    trigger: { type: "manual" },
    nodes: [
      { id: "map1", type: "map", label: "Testimonio", config: { value: { title: "Cliente feliz", summary: "Musa nos ahorró 10 horas semanales de diseño.", source: "Ana P., Marketing Lead" } }, position: { x: 40, y: 120 } },
      { id: "post1", type: "template", label: "Card quote", config: { templateId: "", frameId: "", format: "post", maxItems: 1 }, position: { x: 360, y: 120 } },
    ],
    edges: [ { from: "map1", to: "post1" } ],
  },
  {
    id: "preset_calendario",
    name: "Calendario: evento → recordatorio",
    description: "Lee eventos de una API JSON (tu agenda) → para cada evento próximo crea un post recordatorio.",
    trigger: { type: "schedule", cron: "0 6 * * *", timezone: "America/Lima" },
    nodes: [
      { id: "src1", type: "source_http", label: "Eventos", config: { url: "https://api.example.com/calendar/upcoming", listPath: "events", limit: 5 }, position: { x: 40, y: 120 } },
      { id: "post1", type: "template", label: "Post recordatorio", config: { templateId: "", frameId: "", format: "post", maxItems: 3 }, position: { x: 360, y: 120 } },
      { id: "rep1", type: "report", label: "Reporte", config: { title: "Recordatorios" }, position: { x: 700, y: 120 } },
    ],
    edges: [ { from: "src1", to: "post1" }, { from: "post1", to: "rep1" } ],
  },
  {
    id: "preset_newsletter",
    name: "Newsletter: digest de N feeds",
    description: "3 feeds → IA escribe un digest largo estilo newsletter → frame documento + reporte.",
    trigger: { type: "schedule", cron: "0 6 * * 5", timezone: "America/Lima" },
    nodes: [
      { id: "rss1", type: "source_rss", label: "Feed 1", config: { url: "https://feeds.bbci.co.uk/mundo/rss.xml", limit: 8 }, position: { x: 40, y: 40 } },
      { id: "rss2", type: "source_rss", label: "Feed 2", config: { url: "https://rss.dw.com/rdf/rss-sp-top", limit: 8 }, position: { x: 40, y: 180 } },
      { id: "rss3", type: "source_rss", label: "Feed 3", config: { url: "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada", limit: 8 }, position: { x: 40, y: 320 } },
      { id: "ai1", type: "ai", label: "Redactor newsletter", config: { provider: "openrouter", model: "", credentialId: null, systemPrompt: "Eres editor de newsletter. Con las noticias, escribe un digest de 5 bloques cortos con subtítulos. Tono cercano, frases cortas.", prompt: "Noticias de esta semana: {{steps.rss1.items}} {{steps.rss2.items}} {{steps.rss3.items}}", maxOutputTokens: 1_500 }, position: { x: 360, y: 180 } },
      { id: "doc1", type: "template", label: "Documento", config: { templateId: "", frameId: "", format: "custom", maxItems: 1 }, position: { x: 700, y: 180 } },
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
      { key: "marca", label: "Marca", type: "text", required: true },
      { key: "rubro", label: "Rubro / categoría", type: "text", required: false, default: "" },
      { key: "publico", label: "Público objetivo", type: "text", required: false, default: "" },
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
      { key: "tema", label: "¿Qué investigar?", type: "text", required: true },
      { key: "enfoque", label: "Enfoque o preguntas guía", type: "textarea", required: false, default: "" },
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
      { key: "evento", label: "Nombre del evento", type: "text", required: true },
      { key: "fecha", label: "Fecha", type: "date", required: true },
      { key: "ciudad", label: "Lugar / ciudad", type: "text", required: false, default: "" },
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
      { key: "tema", label: "¿De qué son los copys?", type: "text", required: true },
      { key: "cantidad", label: "¿Cuántos copys? (1-5)", type: "number", required: false, default: "3" },
      { key: "fechaInicio", label: "Primera fecha de publicación", type: "date", required: true },
      { key: "tono", label: "Tono o notas de marca", type: "textarea", required: false, default: "" },
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
