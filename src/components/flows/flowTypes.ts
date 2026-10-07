// REQ-027 — Tipos y helpers de UI compartidos entre FlowsTab y FlowEditor.
// SIN llamadas de red aquí: toda operación va por mcpCall a las MISMAS tools
// flow_* que usa una IA (MCP-first).

export interface FlowNode {
  id: string;
  type: string;
  label: string;
  enabled?: boolean;
  onError?: "stop" | "continue";
  /** Reintentos automáticos al fallar (0-5; engine aplica backoff). */
  retry?: number;
  config: Record<string, any>;
  position: { x: number; y: number };
}

export interface FlowEdge {
  from: string;
  to: string;
  /** "true"/"false" (condition), "error" (cualquier nodo), "fallback" o etiqueta de regla (switch). */
  when?: string;
}

export interface FlowTrigger {
  type: "manual" | "webhook" | "schedule" | "error";
  cron?: string;
  timezone?: string;
  secretHash?: string;
  /** Posición del nodo inicial en el canvas del editor (solo UI; el run la ignora). */
  position?: { x: number; y: number };
  /** Nodo marcado con la línea del disparo (solo UI, organizativa; el run empieza en los nodos fuente). */
  entry?: string;
}

export interface FlowDef {
  id?: string;
  name: string;
  enabled: boolean;
  trigger: FlowTrigger | null;
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** Etiquetas (D1) y variables (B10): flow_get las devuelve; el editor las
   *  reenvía en flow_save (vaciar el campo las limpia). */
  tags?: string[];
  vars?: Record<string, unknown>;
}

export interface FlowSummary {
  id: string;
  name: string;
  enabled: boolean;
  trigger: FlowTrigger | null;
  nodes: number;
  createdBy?: string;
  updatedAt?: string;
  /** Etiquetas libres (D1): flow_save las persiste; el board filtra por ellas. */
  tags?: string[];
}

export interface FlowCredential {
  id: string;
  name: string;
  type: "bearer" | "api_key" | "basic" | "ai_provider";
  provider?: string | null;
  model?: string | null;
  header_name?: string | null;
  username?: string | null;
  last4?: string | null;
}

export interface FlowRunStep {
  nodeId: string;
  label: string;
  type: string;
  ok: boolean;
  ms: number;
  input?: unknown;
  output?: unknown;
  pinned?: boolean;
  error?: { code: string; message: string };
}

export interface FlowRun {
  runId: string;
  flowId: string;
  status: "running" | "success" | "failed" | string;
  error?: string | null;
  startedAt: string;
  finishedAt?: string | null;
  steps?: FlowRunStep[];
}

export const AI_PROVIDERS = ["gemini", "deepseek", "glm", "openrouter"] as const;

/** Paleta del editor: mismo set de nodos que valida flow_save (NODE_SCHEMA_DOC). */
export const NODE_PALETTE: { type: string; label: string; hint: string; config: () => Record<string, any> }[] = [
  { type: "source_rss", label: "RSS", hint: "Feed de noticias", config: () => ({ url: "", limit: 10 }) },
  { type: "source_nitter", label: "X (Nitter)", hint: "Cuenta de X vía instancia", config: () => ({ username: "", instanceUrl: "https://nitter.net", limit: 15 }) },
  { type: "source_http", label: "API JSON", hint: "GET/POST que devuelve items", config: () => ({ url: "", method: "GET", listPath: "", limit: 10 }) },
  { type: "ai", label: "IA", hint: "Gemini/DeepSeek/GLM/OpenRouter", config: () => ({ provider: "openrouter", model: "", systemPrompt: "", prompt: "", maxOutputTokens: 400, credentialId: "", maxItems: 3 }) },
  { type: "template", label: "Template", hint: "Frame exacto de TU archivo", config: () => ({ templateId: "", frameId: "", format: "post", maxItems: 3 }) },
  { type: "http", label: "HTTP", hint: "Llamada saliente (webhook, API)", config: () => ({ url: "", method: "POST" }) },
  { type: "map", label: "Datos", hint: "Objeto fijo ({{steps.id.x}})", config: () => ({ value: {} }) },
  { type: "condition", label: "Condición", hint: "Ramas when:true/false", config: () => ({ path: "item.title", operator: "not_empty" }) },
  { type: "switch", label: "Switch", hint: "Rutas 1..N por valor + fallback", config: () => ({ path: "item.title", rules: [{ label: "ruta1", operator: "equals", value: "" }], fallback: true }) },
  { type: "loop", label: "Loop", hint: "Procesa en lotes de N items", config: () => ({ batchSize: 5 }) },
  { type: "merge", label: "Merge", hint: "Combina 2+ entradas (append o por clave)", config: () => ({ mode: "append", key: "" }) },
  { type: "wait", label: "Esperar", hint: "Pausa el run N segundos", config: () => ({ seconds: 5 }) },
  { type: "subflow", label: "Sub-flow", hint: "Ejecuta otro flow de tu workspace", config: () => ({ flowId: "", inputs: {} }) },
  { type: "code", label: "Código", hint: "JS inline sobre items/item/input/steps", config: () => ({ js: "// items, item, input, steps disponibles\nreturn items;" }) },
  { type: "tool", label: "Tool MCP", hint: "Llama cualquier herramienta MCP", config: () => ({ tool: "", args: {} }) },
  { type: "text", label: "Texto", hint: "Plantilla de texto", config: () => ({ template: "" }) },
  { type: "report", label: "Reporte", hint: "Resumen del run", config: () => ({ title: "Reporte" }) },
  { type: "note", label: "Nota", hint: "Nota adhesiva (no se ejecuta)", config: () => ({ text: "" }) },
];

export const NODE_META: Record<string, { label: string; color: string }> = {
  source_rss: { label: "RSS", color: "#38bdf8" },
  source_nitter: { label: "X", color: "#38bdf8" },
  source_http: { label: "API", color: "#38bdf8" },
  ai: { label: "IA", color: "#fb7185" },
  template: { label: "Template", color: "#f472b6" },
  http: { label: "HTTP", color: "#fbbf24" },
  map: { label: "Datos", color: "#94a3b8" },
  condition: { label: "Si", color: "#4ade80" },
  switch: { label: "Switch", color: "#facc15" },
  loop: { label: "Loop", color: "#2dd4bf" },
  merge: { label: "Merge", color: "#60a5fa" },
  wait: { label: "Esperar", color: "#fbbf24" },
  subflow: { label: "Sub-flow", color: "#34d399" },
  code: { label: "Código", color: "#f97316" },
  tool: { label: "Tool", color: "#22d3ee" },
  text: { label: "Texto", color: "#94a3b8" },
  report: { label: "Reporte", color: "#fb923c" },
  note: { label: "Nota", color: "#a3e635" },
};

export const SWITCH_OPERATORS = [
  ["equals", "igual a"], ["contains", "contiene"], ["greater_than", ">"], ["less_than", "<"], ["regex", "regex"],
] as const;

export const CONDITION_OPERATORS = [
  ["equals", "igual a"], ["not_equals", "distinto de"], ["contains", "contiene"],
  ["exists", "existe"], ["not_empty", "no vacío"], ["greater_than", ">"], ["less_than", "<"],
] as const;

export function triggerLabel(trigger: FlowTrigger | null): string {
  if (!trigger) return "manual";
  if (trigger.type === "schedule") return `cron ${trigger.cron ?? ""}`.trim();
  if (trigger.type === "error") return "al fallar otro flow";
  return trigger.type;
}

export function nodeSummary(node: FlowNode): string {
  const c = node.config ?? {};
  if (node.type === "source_rss" || node.type === "source_http" || node.type === "http") return String(c.url ?? "sin URL");
  if (node.type === "source_nitter") return c.url ? String(c.url) : `@${c.username ?? "?"}`;
  if (node.type === "ai") return `${c.provider ?? "?"}${c.model ? ` · ${c.model}` : ""}`;
  if (node.type === "template") return c.templateId && c.frameId ? `${c.templateId} → ${c.frameId}` : "a configurar";
  if (node.type === "condition") return `${c.path ?? "?"} ${c.operator ?? ""}`;
  if (node.type === "switch") return `${c.path ?? "?"} · ${Array.isArray(c.rules) ? c.rules.length : 0} reglas`;
  if (node.type === "loop") return `lotes de ${c.batchSize ?? 5}`;
  if (node.type === "merge") return c.mode === "byKey" ? `por clave: ${c.key || "?"}` : "append";
  if (node.type === "wait") return `${c.seconds ?? 5}s`;
  if (node.type === "subflow") return String(c.flowId || "sin flow");
  if (node.type === "code") return "js inline";
  if (node.type === "tool") return String(c.tool || "sin tool");
  if (node.type === "note") return String(c.text ?? "").slice(0, 40);
  if (node.type === "text") return String(c.template ?? "").slice(0, 60);
  if (node.type === "report") return String(c.title ?? "Reporte");
  if (node.type === "map") return `${Object.keys(c.value ?? {}).length} campos`;
  return "";
}
