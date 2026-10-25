/**
 * REQ-058 — Tomas de video (Take Studio): política de TTL de 24 h y cupo.
 *
 * Decisión de producto: las tomas son INSUMO, no archivo. El aviso de la UI
 * dice explícito "máximo 24 horas y luego se borran" para motivar la
 * descarga — el usuario trabaja los videos desde su carpeta local. La
 * purga física NO es un cronjob (decisión: gastaría recursos); es un
 * barrido manual de fin de semana (`scripts/purge-expired-takes.mjs`)
 * y, mientras tanto, la expiración es LAZY: listado y descarga consultan
 * `expiresAt`, así una toma vencida desaparece del producto aunque el
 * objeto siga en R2 hasta el barrido.
 *
 * Honesty rules: funciones puras, sin DOM ni I/O — node-testable.
 */

/** Ventana de vida de una toma — el número exacto que promete el aviso. */
export const TAKE_TTL_MS = 24 * 60 * 60_000;

/** Cupo blando del bucket compartido (R2 free = 10 GB; dejamos 20% de
 *  holgura para los renders/finales del mismo bucket). El server rechaza
 *  el registro de tomas nuevas al superar el cupo con P0001. */
export const TAKES_SOFT_QUOTA_BYTES = 8 * 1024 * 1024 * 1024;

/** Estados persistidos de una toma (CHECK de la migración v84). */
export type TakeState = "uploading" | "ready" | "purged";

export const TAKE_STATES: readonly TakeState[] = ["uploading", "ready", "purged"];

/** Estado DERIVADO por tiempo — la UI y el server derivan, nunca persisten
 *  "expired": la purga es diferida y el estado físico no cambia al vencer. */
export type TakeStatus = "uploading" | "ready" | "expired" | "purged";

export interface TakeStatusInfo {
  status: TakeStatus;
  /** true cuando el TTL venció (lazy) o fue purgada físicamente. */
  expired: boolean;
  /** ms restantes de vida; 0 si ya venció. */
  remainingMs: number;
  /** Texto del countdown para la UI ("23 h 12 min", "8 min", "vencida"). */
  label: string;
}

/** Estado + countdown de una toma a un instante dado. Determinista. */
export function takeStatus(
  state: TakeState,
  expiresAtMs: number,
  nowMs: number,
): TakeStatusInfo {
  if (state === "purged") {
    return { status: "purged", expired: true, remainingMs: 0, label: "purgada" };
  }
  const remainingMs = Math.max(0, expiresAtMs - nowMs);
  if (remainingMs === 0) {
    return { status: "expired", expired: true, remainingMs: 0, label: "vencida" };
  }
  return {
    status: state === "uploading" ? "uploading" : "ready",
    expired: false,
    remainingMs,
    label: humanRemaining(remainingMs),
  };
}

/** Countdown legible SIN emojis (regla UI): "23 h 05 min", "8 min", "< 1 min". */
export function humanRemaining(remainingMs: number): string {
  if (remainingMs <= 0) return "vencida";
  const totalMin = Math.floor(remainingMs / 60_000);
  if (totalMin < 1) return "< 1 min";
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  if (hours === 0) return `${minutes} min`;
  const mm = String(minutes).padStart(2, "0");
  return `${hours} h ${mm} min`;
}

/** ¿Procede subir una toma nueva? Cupo blando por bytes VIVOS (no purgados
 *  y no vencidos — el barrido diferido libera al correr). */
export function canUploadTake(
  liveBytes: number,
  newBytes: number,
  quotaBytes = TAKES_SOFT_QUOTA_BYTES,
): { ok: boolean; reason?: string } {
  if (!Number.isFinite(newBytes) || newBytes <= 0) {
    return { ok: false, reason: "TAKE_SIZE_REQUIRED" };
  }
  if (liveBytes + newBytes > quotaBytes) {
    return {
      ok: false,
      reason: "TAKE_QUOTA_EXCEEDED",
    };
  }
  return { ok: true };
}

/** La descarga exige toma viva: ready (o uploading ya cerrado por el
 *  complete) y dentro del TTL. Un objeto vencido ya no se firma, aunque el
 *  barrido no haya pasado — el aviso de 24 h se cumple aunque el sweep
 *  corrase una vez al mes. */
export function canDownloadTake(state: TakeState, expiresAtMs: number, nowMs: number): boolean {
  if (state !== "ready") return false;
  return expiresAtMs - nowMs > 0;
}

/** expires_at para la fila: creado + TTL. El server SIEMPRE calcula el
 *  vencimiento del lado del reloj del server (nunca acepta el del cliente). */
export function computeExpiresAtMs(createdAtMs: number): number {
  return createdAtMs + TAKE_TTL_MS;
}

/** Nombre de archivo para la descarga local — sin caracteres raros, ordenable. */
export function takeFilename(nowMs: number, ext = "webm"): string {
  const d = new Date(nowMs);
  const p = (n: number) => String(n).padStart(2, "0");
  return `toma-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
}

/** Tamaño legible para la lista de tomas. */
export function humanBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}
