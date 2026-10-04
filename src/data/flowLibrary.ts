// REQ-027 — Biblioteca de flows: 10 presets listos para clonar al workspace.
// ES el formato exportable (mismo JSON que flow_export): sin workspaceId ni
// credenciales — los nodos ai/template quedan "a configurar" (credentialId
// null, templateId/frameId vacíos) y el humano o su IA los completa después
// (picker del editor / flow_save).
//
// Este módulo es PURO (cero React): lo importa la UI (Biblioteca) y el server
// (flow_library_list / flow_library_instantiate en netlify/functions/mcp.mjs)
// — una sola fuente de verdad, cero drift.

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
