/**
 * REQ-055 F2 — video_render async por tickets: máquina de estados PURA.
 *
 * Sin render server-side (imposible en edge — decisión de arquitectura
 * vigente), el render es un ticket que ejecuta el navegador de la propia
 * cuenta: MCP crea el ticket, cualquier sesión del editor de la cuenta lo
 * reclama (claim atómico), renderiza client-side con el core compartido y
 * sube el resultado a Storage. Acá vive SOLO la FSM — la tabla es
 * `supabase_migrations_v83.sql` y el wiring Worker/API queda documentado
 * como shim (archivos en edición por otra sesión).
 *
 * Reglas del REQ:
 *  - El ticket es de la CUENTA (workspace), no del proyecto: sin colas
 *    cruzadas entre workspaces multi-tenant.
 *  - Claim atómico: reclamar dos veces no duplica; un claim expirado vuelve
 *    a `queued` (o lo reclama otra sesión) — nunca un render fantasma.
 *  - Idempotente y honesto: sin sesión abierta el ticket queda `queued`.
 *
 * Honesty rules: funciones puras, nunca lanza, determinista — node-testable.
 */

export type RenderTicketState = "queued" | "running" | "completed" | "failed";

/** Estados espejo del CHECK de `musa_video_render_tickets` (v83). */
export const RENDER_TICKET_STATES: readonly RenderTicketState[] = ["queued", "running", "completed", "failed"];

/** Tiempo de gracia del claim: si `claimedAt` expira sin completar, el
 *  ticket vuelve a estar disponible (el navegador se cerró a media tarea). */
export const CLAIM_TIMEOUT_MS = 10 * 60_000;

export interface RenderTicket {
  id: string;
  projectId: string;
  workspaceId: string;
  state: RenderTicketState;
  /** Formato pedido — espejo del CHECK de la tabla (v83). */
  format: "mp4" | "webm";
  claimedBy?: string;
  /** epoch ms del claim vigente. */
  claimedAtMs?: number;
  attempts: number;
  resultPath?: string;
  error?: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export type FsmResult<T extends RenderTicket = RenderTicket> =
  | { ok: true; ticket: T }
  | { ok: false; reason: string };

/** Un ticket está disponible para claim si nunca se reclamó, o si el claim
 *  vigente expiró (mismo criterio que el WHERE del RPC `musa_claim_render_ticket`). */
export function claimable(t: RenderTicket, nowMs: number): boolean {
  if (t.state === "queued") return true;
  if (t.state === "running" && typeof t.claimedAtMs === "number") {
    return nowMs - t.claimedAtMs > CLAIM_TIMEOUT_MS;
  }
  return false;
}

/** El claim expiró (para el barrido que lo re-encola). */
export function claimExpired(t: RenderTicket, nowMs: number): boolean {
  return t.state === "running" && typeof t.claimedAtMs === "number" && nowMs - t.claimedAtMs > CLAIM_TIMEOUT_MS;
}

/** Reclama un ticket (queued o con claim expirado). Pura: devuelve el ticket
 *  nuevo o la razón por la que no procede — el RPC hace la misma comprobación
 *  de forma atómica bajo row lock. */
export function claimTicket(t: RenderTicket, sessionId: string, nowMs: number): FsmResult {
  if (!sessionId.trim()) return { ok: false, reason: "SESSION_REQUIRED" };
  if (t.state === "completed") return { ok: false, reason: "ALREADY_COMPLETED" };
  if (t.state === "failed") return { ok: false, reason: "ALREADY_FAILED" };
  if (!claimable(t, nowMs)) return { ok: false, reason: "NOT_CLAIMABLE" };
  return {
    ok: true,
    ticket: {
      ...t,
      state: "running",
      claimedBy: sessionId,
      claimedAtMs: nowMs,
      attempts: t.attempts + 1,
      updatedAtMs: nowMs,
    },
  };
}

/** Marca completado — solo la sesión que reclama puede cerrarlo. */
export function completeTicket(t: RenderTicket, sessionId: string, resultPath: string, nowMs: number): FsmResult {
  if (t.state !== "running") return { ok: false, reason: "NOT_RUNNING" };
  if (t.claimedBy !== sessionId) return { ok: false, reason: "NOT_CLAIM_OWNER" };
  if (!resultPath.trim()) return { ok: false, reason: "RESULT_REQUIRED" };
  return { ok: true, ticket: { ...t, state: "completed", resultPath, error: undefined, updatedAtMs: nowMs } };
}

/** Marca fallido con el error accionable — el archivo local queda en el
 *  editor para descarga manual (regla del REQ). */
export function failTicket(t: RenderTicket, sessionId: string, error: string, nowMs: number): FsmResult {
  if (t.state !== "running") return { ok: false, reason: "NOT_RUNNING" };
  if (t.claimedBy !== sessionId) return { ok: false, reason: "NOT_CLAIM_OWNER" };
  return { ok: true, ticket: { ...t, state: "failed", error, resultPath: undefined, updatedAtMs: nowMs } };
}

/** Re-encola un claim expirado (barrido o reintento explícito). */
export function requeueTicket(t: RenderTicket, nowMs: number): FsmResult {
  if (!claimExpired(t, nowMs)) return { ok: false, reason: "NOT_EXPIRED" };
  return {
    ok: true,
    ticket: { ...t, state: "queued", claimedBy: undefined, claimedAtMs: undefined, updatedAtMs: nowMs },
  };
}

/** Fabrica el ticket inicial (el Worker en el shim de `video_render`). */
export function newRenderTicket(input: { id: string; projectId: string; workspaceId: string; format?: "mp4" | "webm"; createdBy?: string; nowMs: number }): RenderTicket {
  const now = input.nowMs;
  return {
    id: input.id,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    state: "queued",
    format: input.format ?? "mp4",
    attempts: 0,
    createdAtMs: now,
    updatedAtMs: now,
  };
}
