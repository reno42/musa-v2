// ═══════════════════════════════════════════════════════════════════
// REQ-026 Item 1 — normalizador compartido de tarjetas del Kanban.
//
// `acceptance` es JSONB string[] en filas nuevas, pero filas legacy
// (card_ms7xkdc8, card_ms7xx73e, card_msdkgy36, card_ms8lf0aw — y
// cualquier llamador que mandó un string suelto) traen un STRING
// multilínea. Sin este guard, el render de detalle crashea con
// "acceptance.map is not a function" (BUG-001 del dogfood 24-sep).
//
// Mismo código que vivía inline en KanbanTab.fetchTasks — ahora
// compartido por el tablero (KanbanTab) y la vista Tabla
// (KanbanTableView). La migración v57 mata la raíz en DB.
// ═══════════════════════════════════════════════════════════════════

/** Acepta array, string multilínea o string de 1 línea; devuelve siempre string[] (trim + sin vacíos). */
export function normalizeAcceptance(value: unknown): string[] {
  if (Array.isArray(value)) return value as string[];
  if (typeof value === "string") return value.split("\n").map(s => s.trim()).filter(Boolean);
  return [];
}

/** Copia la tarea con `acceptance` normalizado; el resto de campos intactos. */
export function normalizeTask<T extends { acceptance?: unknown }>(task: T): T {
  return { ...task, acceptance: normalizeAcceptance(task.acceptance) };
}
