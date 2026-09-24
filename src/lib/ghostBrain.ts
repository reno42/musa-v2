// ghostBrain — FASE 2: EL decisor del loop agéntico, AISLADO en este archivo
// (REPORTE_MIRA_fase2_ghost.md Parte 2 + REGLAS GENERALES). Hoy decide por LLM;
// cuando el router v3 tenga las clases de acciones-UI, este archivo se
// reemplaza por el ONNX SIN tocar el loop ni el gate — esa es la razón de su
// existencia como módulo separado.
//
// El brain NO tiene estado global ni conoce el DOM: recibe el texto de la
// observación (uiToText) y la historia de pasos, y devuelve UNA acción. La
// capa LLM se INYECTA (llmJson) para que el archivo no dependa del proveedor:
// el ChatFAB pasa la misma capa de proveedores que usa el chat (mismo keyless/
// BYOK, mismas llaves).
//
// NO toca el modelo ONNX, labels.json ni umbrales — eso vive en intentRouter.

export const GHOST_MAX_STEPS = 25;

export type GhostStepAction =
  | { action: "click"; selector: string }
  | { action: "type"; selector: string; text: string }
  | { action: "scroll"; direction?: "up" | "down" }
  | { action: "done"; note?: string };

export interface GhostDecision {
  /** Acción única del paso — el vocabulario exacto del spec. */
  step: GhostStepAction;
  /** Una línea del porqué — va al log de pasos (chatfab_decisions). */
  thought: string;
}

/** Capa LLM inyectada: (system, user) → texto del modelo. Lanza en fallo. */
export type GhostLlm = (system: string, user: string) => Promise<string>;

export interface GhostBrainInput {
  /** Objetivo de la tarea, en lenguaje del usuario. */
  task: string;
  /** uiToText(observeUI()) del paso actual. */
  uiText: string;
  /** Historial de pasos ya ejecutados: ["paso 1: click … — ✓", …]. */
  history: string[];
}

const SYSTEM = `Eres el cerebro de un cursor fantasma que opera una app de diseño (Musa) con clics y tipeo REALES sobre el DOM.
Recibes: la tarea, la observación textual de la UI (una línea por elemento con su selector CSS) y la historia de pasos ya ejecutados.

Responde EXCLUSIVAMENTE con un objeto JSON (sin markdown, sin explicación fuera del JSON):
{"action":"click","selector":"<selector EXACTO de la observación>","thought":"<una frase, español>"}
{"action":"type","selector":"<selector EXACTO>","text":"<texto a tipear>","thought":"<una frase>"}
{"action":"scroll","direction":"down|up","thought":"<una frase>"}
{"action":"done","note":"<resultado logrado, español>","thought":"<una frase>"}

Reglas:
- Usa SOLO selectores que aparecen LITERALMENTE en la observación. Si el elemento que necesitas no está, haz scroll o declara done con nota honesta de qué falta.
- Un paso = una acción. Si la tarea ya está cumplida (o ya no puedes avanzar), responde done.
- "done" es exitoso solo si la tarea quedó hecha: la nota debe decir qué quedó hecho; si quedó a medias, dilo en la nota.`;

/** Extrae el primer objeto JSON de una respuesta (tolera fences y preámbulo). */
function parseJsonLoose(raw: string): any | null {
  const cleaned = raw.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

function validateDecision(parsed: any): GhostDecision | null {
  const action = parsed?.action;
  const thought = String(parsed?.thought || "").slice(0, 300);
  if (action === "click" && typeof parsed.selector === "string" && parsed.selector) {
    return { step: { action: "click", selector: parsed.selector }, thought };
  }
  if (action === "type" && typeof parsed.selector === "string" && parsed.selector && typeof parsed.text === "string") {
    return { step: { action: "type", selector: parsed.selector, text: parsed.text.slice(0, 500) }, thought };
  }
  if (action === "scroll") {
    const dir = parsed.direction === "up" ? "up" : "down";
    return { step: { action: "scroll", direction: dir }, thought };
  }
  if (action === "done") {
    return { step: { action: "done", note: String(parsed.note || "").slice(0, 500) }, thought };
  }
  return null;
}

/**
 * Decide UN paso. Sin estado: todo entra por parámetro. Con 1 reintento con
 * feedback del error de parseo (los JSON rotos del primer intento no tumban
 * la coreografía). Si el LLM mismo falla, el error sube — el loop decide
 * cómo reportarlo honesto.
 */
export async function decideStep(llm: GhostLlm, input: GhostBrainInput): Promise<GhostDecision> {
  const historyText = input.history.length
    ? input.history.map((h, i) => `${i + 1}. ${h}`).join("\n")
    : "(sin pasos todavía — eres el paso 1)";
  const user = `TAREA: ${input.task}\n\nUI OBSERVADA:\n${input.uiText || "(vacía — no hay elementos interactivos visibles)"}\n\nPASOS YA EJECUTADOS:\n${historyText}`;
  const raw = await llm(SYSTEM, user);
  const first = parseJsonLoose(raw);
  const valid = first && validateDecision(first);
  if (valid) return valid;
  // Reintento único con el error a la vista del modelo.
  const raw2 = await llm(
    SYSTEM,
    `${user}\n\nTu respuesta anterior no fue JSON válido con una acción conocida (${String(raw).slice(0, 160)}). Responde de nuevo, SOLO el objeto JSON.`,
  );
  const second = parseJsonLoose(raw2);
  const valid2 = second && validateDecision(second);
  if (valid2) return valid2;
  throw new Error(`ghostBrain: el decisor no devolvió una acción válida (${String(raw2).slice(0, 120)})`);
}
