/**
 * maintenanceLogic — lógica PURA del mantenimiento nightly (respaldos +
 * barrido de papelera). Cero imports: la importa el servicio (platform-
 * Maintenance) y la suite QA (node --experimental-strip-types) sin tocar
 * Supabase ni el runtime de Workers.
 *
 * Diseño de respaldo (v1, freemium):
 *  - BASE única: primera corrida exporta todo; si no cabe en el cap, resume
 *    noches siguientes por progreso {lastId} hasta terminarla.
 *  - INCREMENTAL diario: filas con ts > watermark por tabla. Tablas sin
 *    columna de tiempo confiable van en modo FULL (re-export chico cada día).
 *  - CAP duro por corrida: si una tabla no cupo, su watermark no avanza y
 *    la noche siguiente continúa — nunca un día de tráfico rompe el free.
 *  - RETENCIÓN: archivos >14 días se borran del bucket por el mismo cron.
 */

export interface BackupTableConfig {
  table: string;
  /** Columna de tiempo para incremental; null = modo FULL (re-export). */
  ts: "updated_at" | "created_at" | null;
}

/** Tablas respaldadas v1. Las FULL son chicas por diseño; revisar si crecen. */
export const BACKUP_TABLES: readonly BackupTableConfig[] = [
  { table: "workspaces", ts: "updated_at" },
  { table: "workspace_members", ts: null },
  { table: "user_profiles", ts: "updated_at" },
  { table: "templates", ts: "updated_at" },
  { table: "assets", ts: "updated_at" },
  { table: "photo_catalog_items", ts: null },
  { table: "content_calendar", ts: "updated_at" },
  { table: "copy_recipes", ts: "updated_at" },
  { table: "design_comments", ts: null },
];

/** Hora UTC a la que corre el intento diario (el cron tickea cada 5 min). */
export const BACKUP_HOUR_UTC = 3;
/** Cap duro de bytes JSON por corrida — protección del plan free. */
export const BACKUP_CAP_BYTES = 20 * 1024 * 1024;
/** Filas por batch dentro de una tabla (templates son filas grandes). */
export const BACKUP_BATCH_ROWS = 100;
/** Días de retención de archivos de respaldo en el bucket. */
export const BACKUP_RETENTION_DAYS = 14;
/** Días que un asset vive en la papelera antes del barrido (regla existente). */
export const TRASH_EXPIRY_DAYS = 30;
/** Tamaño de batch del barrido de papelera. */
export const SWEEP_BATCH = 100;

/** Estado persistido en platform_config key "backups". */
export interface BackupState {
  lastAttemptDate: string; // "2026-10-22" (UTC) — evita doble corrida el mismo día
  baseCompletedAt: string | null; // ISO — la base completa ya existe
  /** Progreso por tabla: watermark ts y/o lastId del batch base. */
  progress: Record<string, { ts?: string; lastId?: string }>;
  lastResult?: string;
}

export function emptyBackupState(): BackupState {
  return { lastAttemptDate: "", baseCompletedAt: null, progress: {} };
}

export function utcDateKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Chequeo puro de hora (sin DB): ¿ya llegamos a la hora de respaldo de hoy? */
export function backupHourReached(now: Date): boolean {
  return now.getUTCHours() >= BACKUP_HOUR_UTC;
}

/**
 * ¿Toca correr el respaldo en este tick? Una vez por día UTC, desde las
 * BACKUP_HOUR_UTC. Correr ANTES de marcar lastAttemptDate (el servicio la
 * marca al iniciar el intento para que los 11 ticks restantes de la hora
 * salgan sin trabajo).
 */
export function backupDue(now: Date, state: BackupState): boolean {
  if (!backupHourReached(now)) return false;
  return state.lastAttemptDate !== utcDateKey(now);
}

/** Modo de esta corrida: base (primera vez / base incompleta) o incremental. */
export function backupMode(state: BackupState): "base" | "incremental" {
  return state.baseCompletedAt ? "incremental" : "base";
}

/**
 * ¿Está esta tabla pendiente en esta corrida?
 *  - FULL: siempre pendiente (re-export chico por corrida).
 *  - ts: pendiente si su watermark no alcanzó el arranque de la corrida.
 *  - base: pendiente si el progreso {lastId} no llegó al final (lastId vacío
 *    = sin empezar; "done" = completa).
 */
export function tablePending(cfg: BackupTableConfig, state: BackupState, runStartedAt: string): boolean {
  const p = state.progress[cfg.table];
  if (!state.baseCompletedAt) {
    // Modo base: pendiente mientras lastId !== "done"
    return (p?.lastId ?? "") !== "done";
  }
  if (!cfg.ts) return true; // FULL mode
  return (p?.ts ?? "") !== runStartedAt;
}

/** Cutoff ISO para el filtro incremental de una corrida que empieza ahora. */
export function incrementalCutoff(now: Date): string {
  return new Date(now.getTime() - 86400_000).toISOString();
}

/** Cutoff ISO de retención: archivos más viejos se borran del bucket. */
export function retentionCutoff(now: Date, days: number = BACKUP_RETENTION_DAYS): string {
  return new Date(now.getTime() - days * 86400_000).toISOString();
}

/** ¿Un asset en papelera ya expiró (regla >30 días del endpoint existente)? */
export function isTrashExpired(deletedAt: string | null | undefined, now: Date, days: number = TRASH_EXPIRY_DAYS): boolean {
  if (!deletedAt) return false;
  const t = Date.parse(deletedAt);
  if (!Number.isFinite(t)) return false;
  return t <= now.getTime() - days * 86400_000;
}

/** Nombre de archivo del dump de esta corrida. */
export function backupPath(now: Date, mode: "base" | "incremental"): string {
  return `dumps/${utcDateKey(now)}/${mode}-${now.toISOString().replace(/[:.]/g, "-")}.json.gz`;
}

/** ¿Cabe este chunk sin pasarse del cap? (medición sobre JSON serializado) */
export function fitsInCap(currentBytes: number, chunkJson: string, cap: number = BACKUP_CAP_BYTES): boolean {
  return currentBytes + Buffer.byteLength(chunkJson) <= cap;
}
