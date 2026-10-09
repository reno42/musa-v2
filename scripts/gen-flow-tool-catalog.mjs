// Genera src/data/flowToolCatalog.ts desde tools_catalog.json (schemas REALES).
// Uso: node scripts/gen-flow-tool-catalog.mjs  (desde la raíz del repo)
import { readFileSync, writeFileSync } from "node:fs";

const catalog = JSON.parse(readFileSync("tools_catalog.json", "utf8"));
const byName = new Map(catalog.map((t) => [t.name, t]));

// Curación: tool → { label ES, cat, tier 0=P0|1=P1|2=avanzadas, write?, kw?, args?, hint? }
const CURATION = {
  // ---- P0 (tier 0): el ciclo social → CRM → marca → render ----
  list_social_inbox: { label: "Bandeja: leer", cat: "social", tier: 0, kw: "inbox mensajes dm bandeja social", hint: "Mensajes pendientes de tus cuentas conectadas" },
  reply_social: { label: "Responder mensaje", cat: "social", tier: 0, write: true, kw: "reply responder dm contestar", args: { messageId: "{{item.id}}", text: "" }, hint: "Contesta un mensaje de la bandeja" },
  capture_social_contact: { label: "Capturar contacto", cat: "social", tier: 0, write: true, kw: "lead captura contacto crm", hint: "Guarda un contacto desde una conversación social" },
  publish_content: { label: "Publicar contenido", cat: "social", tier: 0, write: true, kw: "publicar post feed publicar", hint: "Publica contenido en una cuenta conectada" },
  list_calendar_entries: { label: "Calendario: leer", cat: "social", tier: 0, kw: "calendario agenda contenido", hint: "Entradas del calendario de contenidos" },
  add_content_idea: { label: "Idea: crear", cat: "social", tier: 0, write: true, kw: "idea propuesta calendario", args: { scheduledDate: "{{item.fecha}}", topic: "{{item.gancho}}", copy: "{{item.cuerpo}}" }, hint: "Agrega una idea al calendario" },
  create_crm_contact: { label: "Contacto: crear", cat: "crm", tier: 0, write: true, kw: "crm contacto nuevo", hint: "Crea un contacto en el CRM" },
  create_crm_deal: { label: "Deal: crear", cat: "crm", tier: 0, write: true, kw: "deal oportunidad negocio", hint: "Crea un deal en el pipeline" },
  update_crm_deal: { label: "Deal: actualizar", cat: "crm", tier: 0, write: true, kw: "deal actualizar etapa stage", hint: "Actualiza un deal existente" },
  log_interaction: { label: "Interacción: registrar", cat: "crm", tier: 0, write: true, kw: "interaccion nota llamada email", hint: "Registra una interacción con un contacto/deal" },
  get_crm_overview: { label: "Pipeline: resumen", cat: "crm", tier: 0, kw: "pipeline overview embudo resumen", hint: "Resumen del pipeline del workspace" },
  validate_brand: { label: "Validar marca", cat: "marca", tier: 0, kw: "brand validar consistencia", hint: "Valida un diseño contra la guía de marca" },
  lint_design: { label: "Lint de diseño", cat: "marca", tier: 0, kw: "lint calidad revisión", hint: "Revisión automática de calidad del diseño" },
  render_batch: { label: "Render en lote", cat: "diseno", tier: 0, write: true, kw: "render lote batch png exportar", hint: "Renderiza varios frames del template" },
  // ---- P1 (tier 1): diseño, contenido, foto, ops ----
  batch_render_html: { label: "Render HTML en lote", cat: "diseno", tier: 1, write: true, kw: "html render lote carousel" },
  export_frame: { label: "Exportar frame", cat: "diseno", tier: 1, write: true, kw: "export frame png jpg" },
  render_frame_png: { label: "Render PNG", cat: "diseno", tier: 1, write: true, kw: "png render frame imagen" },
  export_template: { label: "Exportar template", cat: "diseno", tier: 1, write: true, kw: "export template zip" },
  export_pdf: { label: "Exportar PDF", cat: "diseno", tier: 1, write: true, kw: "pdf export documento" },
  create_html_carousel: { label: "Carrusel HTML", cat: "diseno", tier: 1, write: true, kw: "carrusel carousel html slides" },
  create_chart: { label: "Gráfico de datos", cat: "diseno", tier: 1, write: true, kw: "chart gráfico datos barras" },
  apply_csv_to_frames: { label: "CSV → frames", cat: "diseno", tier: 1, write: true, kw: "csv batch frames aplicar" },
  adapt_all_formats: { label: "Adaptar formatos", cat: "diseno", tier: 1, write: true, kw: "adaptar post story formatos" },
  edit_text_content: { label: "Editar texto", cat: "diseno", tier: 1, write: true, kw: "editar texto copy frame" },
  update_element: { label: "Actualizar elemento", cat: "diseno", tier: 1, write: true, kw: "elemento update modificar" },
  add_element: { label: "Agregar elemento", cat: "diseno", tier: 1, write: true, kw: "elemento agregar insert" },
  set_html: { label: "Set HTML", cat: "diseno", tier: 1, write: true, kw: "html set escribir" },
  set_css: { label: "Set CSS", cat: "diseno", tier: 1, write: true, kw: "css set estilo" },
  get_css_variables: { label: "Variables CSS: leer", cat: "diseno", tier: 1, kw: "css variables tokens" },
  set_css_variable: { label: "Variable CSS: setear", cat: "diseno", tier: 1, write: true, kw: "css variable token" },
  extract_variables: { label: "Extraer variables", cat: "diseno", tier: 1, kw: "extraer variables tokens" },
  apply_variables: { label: "Aplicar variables", cat: "diseno", tier: 1, write: true, kw: "aplicar variables tokens" },
  create_html_frame: { label: "Frame HTML: crear", cat: "diseno", tier: 1, write: true, kw: "frame html crear nuevo" },
  update_html_frame: { label: "Frame HTML: actualizar", cat: "diseno", tier: 1, write: true, kw: "frame html actualizar" },
  get_html_frames: { label: "Frames HTML: leer", cat: "diseno", tier: 1, kw: "frames html leer listar" },
  list_templates: { label: "Templates: listar", cat: "diseno", tier: 1, kw: "templates listar archivos" },
  find_templates: { label: "Templates: buscar", cat: "diseno", tier: 1, kw: "templates buscar find" },
  get_template: { label: "Template: leer", cat: "diseno", tier: 1, kw: "template leer get" },
  get_template_structure: { label: "Template: estructura", cat: "diseno", tier: 1, kw: "template estructura frames" },
  list_frames: { label: "Frames: listar", cat: "diseno", tier: 1, kw: "frames listar" },
  get_frame: { label: "Frame: leer", cat: "diseno", tier: 1, kw: "frame leer get" },
  update_content: { label: "Contenido: actualizar", cat: "social", tier: 1, write: true, kw: "contenido actualizar calendario" },
  list_social_accounts: { label: "Cuentas: listar", cat: "social", tier: 1, kw: "cuentas social conectadas" },
  get_attribution_report: { label: "Atribución: reporte", cat: "social", tier: 1, kw: "atribución reporte analytics" },
  list_campaign_report: { label: "Campañas: reporte", cat: "social", tier: 1, kw: "campañas reporte métricas" },
  list_crm_deals: { label: "Deals: listar", cat: "crm", tier: 1, kw: "deals listar pipeline" },
  list_interactions: { label: "Interacciones: listar", cat: "crm", tier: 1, kw: "interacciones listar historial" },
  check_contrast: { label: "Contraste", cat: "marca", tier: 1, kw: "contraste colores wcag" },
  check_accessibility: { label: "Accesibilidad", cat: "marca", tier: 1, kw: "accesibilidad a11y wcag" },
  get_brands: { label: "Marcas: listar", cat: "marca", tier: 1, kw: "marcas listar brands" },
  resolve_brand: { label: "Marca: resolver", cat: "marca", tier: 1, kw: "marca resolver brand" },
  apply_brand: { label: "Aplicar marca", cat: "marca", tier: 1, write: true, kw: "aplicar marca brand tokens" },
  get_brand_playbook: { label: "Playbook de marca", cat: "marca", tier: 1, kw: "playbook marca guía" },
  photo_list_assets: { label: "Assets: listar", cat: "foto_video", tier: 1, kw: "assets fotos listar" },
  photo_open_session: { label: "Foto: abrir sesión", cat: "foto_video", tier: 1, kw: "foto sesión editor abrir" },
  photo_create_variant: { label: "Foto: variante", cat: "foto_video", tier: 1, write: true, kw: "foto variante crop resize" },
  photo_apply_preset: { label: "Foto: preset", cat: "foto_video", tier: 1, write: true, kw: "foto preset filtro" },
  optimize_image: { label: "Optimizar imagen", cat: "foto_video", tier: 1, write: true, kw: "optimizar comprimir imagen peso" },
  ai_generate_image: { label: "Imagen IA", cat: "foto_video", tier: 1, write: true, kw: "ia imagen generar ai" },
  list_copy_recipes: { label: "Recetas de copy", cat: "social", tier: 1, kw: "copy recetas textos plantillas" },
  comment_add: { label: "Comentar diseño", cat: "diseno", tier: 1, write: true, kw: "comentar comment feedback" },
  share_design: { label: "Compartir diseño", cat: "diseno", tier: 1, write: true, kw: "compartir share link" },
  get_weekly_report_csv: { label: "Reporte semanal CSV", cat: "crm", tier: 1, kw: "reporte semanal csv export" },
  task_queue_add: { label: "Tarea en cola", cat: "entrega", tier: 1, write: true, kw: "tarea cola queue job" },
  ai_translate: { label: "Traducir texto", cat: "ia", tier: 1, kw: "traducir translate idioma" },
  search_stock_image: { label: "Stock: buscar", cat: "foto_video", tier: 1, kw: "stock buscar imagen foto" },
  // ---- P2 (tier 2): solo con «Mostrar avanzadas» ----
  video_export: { label: "Exportar video", cat: "foto_video", tier: 2, write: true, kw: "video export mp4" },
  get_design_import_status: { label: "Importación: estado", cat: "diseno", tier: 2, kw: "import estado figma" },
  query_design_graph: { label: "Grafo: consultar", cat: "diseno", tier: 2, kw: "grafo graph query" },
  process_daily_batch: { label: "Batch diario", cat: "entrega", tier: 2, write: true, kw: "batch diario proceso" },
  musa_batch_run: { label: "Batch run", cat: "entrega", tier: 2, kw: "batch run lote" },
  comment_list: { label: "Comentarios: listar", cat: "diseno", tier: 2, kw: "comentarios listar" },
  comment_resolve: { label: "Comentario: resolver", cat: "diseno", tier: 2, write: true, kw: "comentario resolver cerrar" },
  comment_reply: { label: "Comentario: responder", cat: "diseno", tier: 2, write: true, kw: "comentario responder reply" },
  ai_palette: { label: "Paleta IA", cat: "ia", tier: 2, kw: "paleta colores ia" },
  ai_suggest_layout: { label: "Layout IA", cat: "ia", tier: 2, kw: "layout sugerencia ia composición" },
  list_workspace_texts: { label: "Textos del workspace", cat: "diseno", tier: 2, kw: "textos workspace listar" },
  list_all_texts: { label: "Textos: todos", cat: "diseno", tier: 2, kw: "textos todos listar" },
  search_icons: { label: "Iconos: buscar", cat: "foto_video", tier: 2, kw: "iconos buscar icons" },
  insert_icon: { label: "Icono: insertar", cat: "foto_video", tier: 2, write: true, kw: "icono insertar insert" },
  match_color: { label: "Color: emparejar", cat: "foto_video", tier: 2, kw: "color emparejar match" },
  get_metrics: { label: "Métricas", cat: "social", tier: 2, kw: "métricas metrics" },
  get_recent_activity: { label: "Actividad reciente", cat: "crm", tier: 2, kw: "actividad reciente feed" },
  list_pending_actions: { label: "Acciones pendientes", cat: "crm", tier: 2, kw: "pendientes acciones todo" },
  get_dashboard_summary: { label: "Resumen dashboard", cat: "crm", tier: 2, kw: "dashboard resumen summary" },
};

// Validación: toda tool curada DEBE existir en el catálogo real.
const unknown = Object.keys(CURATION).filter((n) => !byName.has(n));
if (unknown.length) {
  console.error(`CURACIÓN CON NOMBRES DESCONOCIDOS (${unknown.length}):`, unknown.join(", "));
  process.exit(1);
}

// Extrae fields desde el inputSchema REAL (ignora workspaceId: lo fuerza el engine).
function fieldsOf(tool) {
  const schema = tool.inputSchema ?? {};
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  return Object.entries(props)
    .filter(([key]) => key !== "workspaceId")
    .map(([key, p]) => {
      const enumVals = Array.isArray(p.enum) ? p.enum.map((v) => String(v)) : null;
      let type = "string";
      if (enumVals) type = "enum";
      else if (p.type === "number" || p.type === "integer") type = "number";
      else if (p.type === "boolean") type = "boolean";
      else if (p.type === "array" || p.type === "object") type = "json";
      const help = String(p.description ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
      return {
        key,
        type,
        required: required.has(key),
        ...(enumVals ? { options: enumVals } : {}),
        ...(help ? { help } : {}),
      };
    });
}

const descOf = (t) => String(t.description ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
const tsStr = (s) => JSON.stringify(s);
const entries = Object.entries(CURATION).map(([name, cur]) => {
  const tool = byName.get(name);
  return {
    tool: name,
    label: cur.label,
    hint: cur.hint ?? descOf(tool),
    cat: cur.cat,
    tier: cur.tier,
    write: !!cur.write,
    kw: cur.kw ?? "",
    args: cur.args ?? {},
    fields: fieldsOf(tool),
  };
});

const json = (v) => JSON.stringify(v, null, 0).replace(/"([a-zA-Z_][a-zA-Z0-9_]*)":/g, "$1: ");
const out = `// Catálogo de tools de Musa expuestas como nodos del flow builder (plan FLOW_NODE_PICKER).
// GENERADO por scripts/gen-flow-tool-catalog.mjs desde tools_catalog.json — no editar a mano:
// actualiza la curación en el script y regenera. Fuente única de verdad consumida por
// la paleta (flowTypes.ts), el editor y el engine (flows-core.mjs: allowlist/budget).
export type FlowToolTier = 0 | 1 | 2;

export type FlowToolField = {
  key: string;
  type: "string" | "number" | "boolean" | "enum" | "json";
  required: boolean;
  options?: string[];
  help?: string;
};

export type FlowToolEntry = {
  tool: string;
  label: string;
  hint: string;
  cat: string;
  tier: FlowToolTier;
  write: boolean;
  kw: string;
  args: Record<string, any>;
  fields: FlowToolField[];
};

export const CATEGORIES: { id: string; label: string; color: string }[] = [
  { id: "fuentes", label: "Fuentes", color: "#38bdf8" },
  { id: "ia", label: "IA", color: "#fb7185" },
  { id: "diseno", label: "Diseño", color: "#f472b6" },
  { id: "social", label: "Social", color: "#a78bfa" },
  { id: "crm", label: "CRM", color: "#34d399" },
  { id: "marca", label: "Marca", color: "#fbbf24" },
  { id: "foto_video", label: "Foto y video", color: "#fb923c" },
  { id: "datos", label: "Datos", color: "#60a5fa" },
  { id: "entrega", label: "Entrega", color: "#facc15" },
  { id: "utilidades", label: "Utilidades", color: "#94a3b8" },
];

export const FLOW_TOOLS: FlowToolEntry[] = [
${entries.map((e) => `  { tool: ${tsStr(e.tool)}, label: ${tsStr(e.label)}, hint: ${tsStr(e.hint)}, cat: ${tsStr(e.cat)}, tier: ${e.tier}, write: ${e.write}, kw: ${tsStr(e.kw)}, args: ${json(e.args)}, fields: ${json(e.fields)} },`).join("\n")}
];

/** tool → tier (allowlist del engine: fuera de este mapa = MUSA_TOOL_DENIED). */
export const FLOW_TOOL_TIERS: Record<string, FlowToolTier> = Object.fromEntries(FLOW_TOOLS.map((t) => [t.tool, t.tier]));

/** Tools de escritura: dedupe anti doble publicación dentro del run. */
export const FLOW_TOOL_WRITE: Set<string> = new Set(FLOW_TOOLS.filter((t) => t.write).map((t) => t.tool));

export function findFlowTool(name: string): FlowToolEntry | undefined {
  return FLOW_TOOLS.find((t) => t.tool === name);
}
`;

writeFileSync("src/data/flowToolCatalog.ts", out);
const counts = { 0: 0, 1: 0, 2: 0 };
for (const e of entries) counts[e.tier]++;
console.log(`OK: ${entries.length} tools (${counts[0]} P0 / ${counts[1]} P1 / ${counts[2]} P2) → src/data/flowToolCatalog.ts`);
