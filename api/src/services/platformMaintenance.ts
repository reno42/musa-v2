/**
 * platformMaintenance — mantenimiento nightly que cuelga del cron existente
 * (worker/index.js scheduled, cada 5 min). Dos pasos INDEPENDIENTES, cada uno
 * con su kill switch y su try/catch (fail-open: un bug acá JAMÁS tumba la
 * API — peor caso, esa noche no hubo respaldo y queda en los logs):
 *
 *  1. BACKUP (BACKUPS_ENABLED !== "false"): base única la primera noche +
 *     incrementales diarios con cap duro y reanudación por batches. Estado en
 *     platform_config key "backups". Archivos .json.gz en el bucket
 *     "platform-backups" con retención de 14 días.
 *  2. TRASH SWEEP (ORPHAN_SWEEP_ENABLED !== "false"): aplica GLOBALMENTE la
 *     misma regla que POST /api/assets/trash/purge-expired — assets en
 *     papelera >30 días se borran de Storage + DB, en batches.
 *
 * Consumo en freemium: +0 invocaciones de cron (mismo trigger), ticks muertos
 * cuestan microsegundos, y el cap garantiza que ni el mayor día de tráfico
 * supera BACKUP_CAP_BYTES de lectura.
 */
import { getSupabaseAdmin } from "./supabase.js";
import {
  BACKUP_BATCH_ROWS,
  BACKUP_CAP_BYTES,
  BACKUP_TABLES,
  SWEEP_BATCH,
  backupDue,
  backupHourReached,
  backupMode,
  backupPath,
  emptyBackupState,
  incrementalCutoff,
  retentionCutoff,
  tablePending,
  utcDateKey,
  type BackupState,
} from "./maintenanceLogic.js";

const STATE_KEY = "backups";
const BUCKET = "platform-backups";
/** Máximo de batches de papelera por noche (5 × SWEEP_BATCH assets). */
const SWEEP_MAX_BATCHES = 5;

function sb2() {
  return getSupabaseAdmin();
}

async function readState(sb: any): Promise<BackupState> {
  try {
    const { data } = await sb.from("platform_config").select("value").eq("key", STATE_KEY).maybeSingle();
    const v = data?.value;
    if (v && typeof v === "object") return { ...emptyBackupState(), ...v };
  } catch { /* pre-schema o DB caída: estado virgen */ }
  return emptyBackupState();
}

async function writeState(sb: any, state: BackupState): Promise<void> {
  await sb.from("platform_config").upsert({ key: STATE_KEY, value: state });
}

/** gzip vía CompressionStream (Workers y Node 18+); null si no está disponible. */
export async function gzipJson(json: string): Promise<Uint8Array | null> {
  const CS = (globalThis as any).CompressionStream;
  if (typeof CS !== "function") return null;
  const stream = new Blob([json]).stream().pipeThrough(new CS("gzip"));
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  return buf;
}

interface TableExportResult {
  rows: any[];
  bytes: number;
  complete: boolean;
  lastId?: string;
}

/** Exporta UNA tabla en batches con cap; actualiza el progreso en el estado. */
async function exportTable(
  sb: any,
  cfg: { table: string; ts: "updated_at" | "created_at" | null },
  state: BackupState,
  opts: { runStartedAt: string; cutoff: string },
): Promise<TableExportResult> {
  const parts: string[] = [];
  let bytes = 0;
  let lastId = "";
  let complete = false;
  const p = state.progress[cfg.table] || {};
  // Reanudación por id en AMBOS modos: el cursor vive en el estado y el
  // watermark incremental no avanza hasta que la tabla termina, así un cap
  // que corta a mitad no pierde filas. Re-leer filas viejas es inocuo: la
  // restauración hace upsert por id.
  const fromId = p.lastId && p.lastId !== "done" ? p.lastId : "";

  for (let i = 0; i < 200; i++) { // 200 × 100 filas = tope absoluto anti-loop
    let q = sb.from(cfg.table).select("*").order("id", { ascending: true }).limit(BACKUP_BATCH_ROWS);
    if (fromId || lastId) q = q.gt("id", lastId || fromId);
    if (state.baseCompletedAt && cfg.ts) {
      // Ventana incremental anclada al dato más viejo entre el watermark de
      // ESTA tabla, la base (primera corrida incremental) y el cutoff 24h.
      let prev = opts.cutoff;
      if (p.ts) { if (p.ts < prev) prev = p.ts; }
      else if (state.baseCompletedAt < prev) prev = state.baseCompletedAt;
      q = q.gt(cfg.ts, prev);
    }
    const { data, error } = await q;
    if (error) throw new Error(`${cfg.table}: ${error.message}`);
    const rows = data || [];
    if (rows.length === 0) { complete = true; break; }
    const chunk = JSON.stringify(rows);
    const chunkBytes = Buffer.byteLength(chunk);
    if (bytes > 0 && bytes + chunkBytes > BACKUP_CAP_BYTES) break; // cap: sin avanzar
    parts.push(chunk.slice(1, -1)); // quita [ ] para concatenar como filas
    bytes += chunkBytes;
    lastId = String(rows[rows.length - 1].id);
    if (rows.length < BACKUP_BATCH_ROWS) { complete = true; break; }
  }

  if (lastId) {
    state.progress[cfg.table] = {
      ...state.progress[cfg.table],
      ...(complete ? { lastId: "done" } : { lastId }),
      // El watermark SOLO avanza con la tabla completa (cap → reanuda mañana).
      ...(complete && state.baseCompletedAt && cfg.ts ? { ts: opts.runStartedAt } : {}),
    };
  } else if (complete && state.baseCompletedAt && cfg.ts) {
    // Tabla incremental sin novedades: igual avanza su watermark (cero filas).
    state.progress[cfg.table] = { ...(state.progress[cfg.table] || {}), ts: opts.runStartedAt };
  }
  return { rows: parts, bytes, complete, lastId };
}

async function ensureBucket(sb: any): Promise<void> {
  try {
    await sb.storage.createBucket(BUCKET, { public: false });
  } catch { /* ya existe (el caso normal) o sin permiso: el upload lo dirá */ }
}

async function applyRetention(sb: any, now: Date): Promise<number> {
  const cutoffTs = new Date(retentionCutoff(now)).getTime();
  let deleted = 0;
  try {
    // Layout dumps/<fecha>/<archivo>: list("") devuelve el nivel raíz
    // (carpetas con id null), hay que bajar nivel por nivel.
    const { data: roots } = await sb.storage.from(BUCKET).list("", { limit: 100 });
    for (const root of roots || []) {
      if (root.id !== null && root.id !== undefined) continue; // archivo suelto: se ignora
      deleted += await purgeStaleInFolder(sb, root.name, cutoffTs);
    }
  } catch { /* bucket aún no existe: nada que retener */ }
  return deleted;
}

async function purgeStaleInFolder(sb: any, prefix: string, cutoffTs: number): Promise<number> {
  let deleted = 0;
  const { data: entries } = await sb.storage.from(BUCKET).list(prefix, { limit: 1000 });
  for (const e of entries || []) {
    const path = `${prefix}/${e.name}`;
    if (e.id === null || e.id === undefined) {
      deleted += await purgeStaleInFolder(sb, path, cutoffTs);
      continue;
    }
    if (e.created_at && new Date(e.created_at).getTime() < cutoffTs) {
      try { await sb.storage.from(BUCKET).remove([path]); deleted++; }
      catch { /* seguir con el resto */ }
    }
  }
  return deleted;
}

async function runBackupStep(now: Date): Promise<Record<string, unknown>> {
  // Pre-check de hora SIN tocar la DB: 276 de los 288 ticks diarios salen acá.
  if (!backupHourReached(now)) return { step: "backup", status: "skipped", reason: "not-due" };
  const sb = sb2();
  if (!sb) return { step: "backup", status: "skipped", reason: "no-supabase" };
  const state = await readState(sb);
  if (!backupDue(now, state)) return { step: "backup", status: "skipped", reason: "not-due" };

  // Marcar el intento ANTES de trabajar: los 11 ticks restantes de la hora
  // salen sin trabajo aunque esta corrida tarde o falle (retry = mañana).
  state.lastAttemptDate = utcDateKey(now);
  await writeState(sb, state);

  const runStartedAt = now.toISOString();
  const cutoff = incrementalCutoff(now);
  const mode = backupMode(state);
  const dump: Record<string, any> = {};
  let bytes = 0;
  let tablesDone = 0;
  let capHit = false;

  for (const cfg of BACKUP_TABLES) {
    if (!tablePending(cfg, state, runStartedAt)) { tablesDone++; continue; }
    const res = await exportTable(sb, cfg, state, { runStartedAt, cutoff });
    if (res.rows.length > 0) {
      dump[cfg.table] = `[${res.rows.join(",")}]`;
      bytes += res.bytes;
    }
    if (res.complete) tablesDone++;
    else { capHit = true; break; } // cap: las tablas siguientes quedan pendientes
  }

  let uploaded: string | null = null;
  if (bytes > 0) {
    const meta = JSON.stringify({
      meta: { mode, startedAt: runStartedAt, capHit, tables: Object.keys(dump), stateVersion: 1 },
      data: dump,
    });
    await ensureBucket(sb);
    const gz = await gzipJson(meta);
    const path = backupPath(now, mode);
    const body: any = gz ?? meta;
    await sb.storage.from(BUCKET).upload(path, body, {
      contentType: gz ? "application/gzip" : "application/json",
      upsert: false,
    });
    uploaded = path;
  }

  // Base completa solo cuando TODAS las tablas terminaron.
  if (mode === "base" && tablesDone >= BACKUP_TABLES.length && !capHit) {
    state.baseCompletedAt = runStartedAt;
  }
  state.lastResult = `ok:${mode}:${bytes}B${capHit ? ":cap" : ""}`;
  await writeState(sb, state);
  const retained = await applyRetention(sb, now);
  return { step: "backup", status: "ok", mode, bytes, tablesDone, of: BACKUP_TABLES.length, capHit, uploaded, retentionDeleted: retained };
}

/** Misma regla que POST /api/assets/trash/purge-expired, pero global y en batches. */
async function runTrashSweepStep(now: Date): Promise<Record<string, unknown>> {
  const sb = sb2();
  if (!sb) return { step: "trash-sweep", status: "skipped", reason: "no-supabase" };
  const cutoff = new Date(now.getTime() - 30 * 86400_000).toISOString();
  let purged = 0;
  for (let b = 0; b < SWEEP_MAX_BATCHES; b++) {
    const { data: expired, error } = await sb.from("assets")
      .select("id, filename, workspace_id")
      .not("deleted_at", "is", null)
      .lt("deleted_at", cutoff)
      .limit(SWEEP_BATCH);
    if (error) throw new Error("trash-sweep select: " + error.message);
    if (!expired || expired.length === 0) break;
    for (const asset of expired) {
      if (asset.filename && asset.workspace_id) {
        try { await sb.storage.from("design-assets").remove([`${asset.workspace_id}/${asset.filename}`]); }
        catch { /* el archivo puede ya no existir */ }
      }
    }
    await sb.from("assets").delete().in("id", expired.map((a: any) => a.id));
    purged += expired.length;
    if (expired.length < SWEEP_BATCH) break;
  }
  return { step: "trash-sweep", status: "ok", purged };
}

/** Punto de entrada del cron: corre los pasos y devuelve el resumen para logs. */
export async function runNightlyMaintenance(now: Date = new Date()): Promise<Record<string, unknown>> {
  // Resumen ANIDADO por paso (backup / trashSweep): cada uno reporta su
  // propio status sin pisar al otro.
  const summary: Record<string, unknown> = {};
  if (process.env.BACKUPS_ENABLED !== "false") {
    try { summary.backup = await runBackupStep(now); }
    catch (e: any) { summary.backup = { step: "backup", status: "error", error: String(e?.message || e) }; }
  } else {
    summary.backup = { step: "backup", status: "skipped", reason: "BACKUPS_ENABLED=false" };
  }
  if (process.env.ORPHAN_SWEEP_ENABLED !== "false") {
    try { summary.trashSweep = await runTrashSweepStep(now); }
    catch (e: any) { summary.trashSweep = { step: "trash-sweep", status: "error", error: String(e?.message || e) }; }
  } else {
    summary.trashSweep = { step: "trash-sweep", status: "skipped", reason: "ORPHAN_SWEEP_ENABLED=false" };
  }
  return summary;
}

