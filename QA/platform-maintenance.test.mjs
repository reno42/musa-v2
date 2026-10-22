/**
 * QA — mantenimiento nightly de plataforma (respaldos + barrido de papelera).
 *
 * Nivel 1 (puro): la lógica de maintenanceLogic.ts importada directo
 * (type-stripping de Node, cero DB/runtime).
 * Nivel 2 (contratos estáticos): el wiring del cron en worker/index.js y
 * los kill switches del servicio.
 *
 * Run: node --experimental-strip-types --test --test-reporter tap QA/platform-maintenance.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BACKUP_CAP_BYTES,
  BACKUP_HOUR_UTC,
  BACKUP_RETENTION_DAYS,
  BACKUP_TABLES,
  TRASH_EXPIRY_DAYS,
  backupDue,
  backupHourReached,
  backupMode,
  backupPath,
  emptyBackupState,
  fitsInCap,
  incrementalCutoff,
  isTrashExpired,
  retentionCutoff,
  tablePending,
  utcDateKey,
} from "../api/src/services/maintenanceLogic.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
// Normalizar CRLF: los needles multi-línea de los contratos no dependen del
// line-ending con el que cada máquina haya tocado los archivos.
const workerSrc = readFileSync(join(ROOT, "worker", "index.js"), "utf8").replace(/\r\n/g, "\n");
const serviceSrc = readFileSync(join(ROOT, "api", "src", "services", "platformMaintenance.ts"), "utf8").replace(/\r\n/g, "\n");

const at = (utcHour, minute = 0) => new Date(`2026-10-22T${String(utcHour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`);

// ── Nivel 1: lógica pura ──

test("utcDateKey devuelve YYYY-MM-DD UTC", () => {
  assert.equal(utcDateKey(at(5, 30)), "2026-10-22");
});

test("backupHourReached: la ventana abre a las BACKUP_HOUR_UTC", () => {
  assert.equal(BACKUP_HOUR_UTC, 3);
  assert.equal(backupHourReached(at(2, 59)), false);
  assert.equal(backupHourReached(at(3, 0)), true);
  assert.equal(backupHourReached(at(23, 0)), true);
});

test("backupDue: una vez por día UTC, solo dentro de la ventana", () => {
  const fresh = emptyBackupState();
  assert.equal(backupDue(at(2, 55), fresh), false); // antes de la hora
  assert.equal(backupDue(at(3, 0), fresh), true);   // primer tick útil
  const done = { ...fresh, lastAttemptDate: "2026-10-22" };
  assert.equal(backupDue(at(3, 5), done), false);   // ya corrió hoy
  assert.equal(backupDue(at(23, 0), done), false);  // ni de noche
});

test("backupMode: base hasta que la base completa existe", () => {
  assert.equal(backupMode(emptyBackupState()), "base");
  assert.equal(backupMode({ ...emptyBackupState(), baseCompletedAt: "2026-10-20T03:00:00Z" }), "incremental");
});

test("tablePending en modo base: pendiente hasta lastId='done'", () => {
  const cfg = BACKUP_TABLES.find((t) => t.table === "templates");
  const state = emptyBackupState(); // baseCompletedAt null
  assert.equal(tablePending(cfg, state, "2026-10-22T03:00:00Z"), true); // sin empezar
  assert.equal(tablePending(cfg, { ...state, progress: { templates: { lastId: "abc" } } }, "x"), true);
  assert.equal(tablePending(cfg, { ...state, progress: { templates: { lastId: "done" } } }, "x"), false);
});

test("tablePending incremental: watermark por tabla, FULL siempre pendiente", () => {
  const tsCfg = BACKUP_TABLES.find((t) => t.table === "templates");
  const fullCfg = BACKUP_TABLES.find((t) => t.ts === null);
  assert.ok(tsCfg && fullCfg, "config de prueba existe");
  const run = "2026-10-22T03:00:00.123Z";
  const state = { ...emptyBackupState(), baseCompletedAt: "2026-10-21T03:00:00Z" };
  assert.equal(tablePending(tsCfg, state, run), true); // sin watermark
  const advanced = { ...state, progress: { templates: { ts: run, lastId: "done" } } };
  assert.equal(tablePending(tsCfg, advanced, run), false); // ya pasado este run
  assert.equal(tablePending(tsCfg, advanced, "2026-10-23T03:00:00.456Z"), true); // día nuevo
  assert.equal(tablePending(fullCfg, advanced, run), true); // FULL: re-export diario
});

test("incrementalCutoff y retentionCutoff son now − N días", () => {
  const now = at(5, 0);
  assert.equal(incrementalCutoff(now), "2026-10-21T05:00:00.000Z");
  assert.equal(retentionCutoff(now), "2026-10-08T05:00:00.000Z");
  assert.equal(BACKUP_RETENTION_DAYS, 14);
  assert.equal(retentionCutoff(now, 7), "2026-10-15T05:00:00.000Z");
});

test("isTrashExpired reproduce la regla >30 días del endpoint existente", () => {
  assert.equal(TRASH_EXPIRY_DAYS, 30);
  const now = at(12, 0);
  assert.equal(isTrashExpired(null, now), false);
  assert.equal(isTrashExpired(undefined, now), false);
  assert.equal(isTrashExpired("no-es-una-fecha", now), false);
  assert.equal(isTrashExpired("2026-09-22T12:00:00Z", now), true);  // 30 días exactos
  assert.equal(isTrashExpired("2026-09-22T12:00:01Z", now), false); // 1s antes del límite
  assert.equal(isTrashExpired("2026-09-01T00:00:00Z", now), true);  // way vencido
});

test("backupPath: dumps/<fecha>/<modo>-<ts>.json.gz", () => {
  const p = backupPath(at(3, 5), "base");
  assert.match(p, /^dumps\/2026-10-22\/base-.+\.json\.gz$/);
  assert.match(backupPath(at(3, 5), "incremental"), /^dumps\/2026-10-22\/incremental-.+\.json\.gz$/);
});

test("fitsInCap mide bytes reales (multibyte incluido)", () => {
  assert.equal(fitsInCap(0, "abc", 10), true);
  assert.equal(fitsInCap(8, "abc", 10), false);
  assert.equal(fitsInCap(0, "ñáé", 100), true); // 6 bytes, no 3 chars
  assert.equal(fitsInCap(5, "ñáé", 10), false); // 5 + 6 > 10
  assert.equal(BACKUP_CAP_BYTES, 20 * 1024 * 1024);
});

test("BACKUP_TABLES: 9 tablas sin duplicados y ts válido", () => {
  assert.equal(BACKUP_TABLES.length, 9);
  const names = BACKUP_TABLES.map((t) => t.table);
  assert.equal(new Set(names).size, names.length);
  for (const t of BACKUP_TABLES) {
    assert.ok(["updated_at", "created_at", null].includes(t.ts), `ts raro en ${t.table}`);
  }
  // workspace_members tiene PK compuesta (workspace_id, user_id) SIN id:
  // debe ir como smallTable (one-shot) o el cursor order("id") explota.
  const wm = BACKUP_TABLES.find((t) => t.table === "workspace_members");
  assert.ok(wm?.smallTable, "workspace_members marcada smallTable");
});

// ── Nivel 2: contratos estáticos ──

test("servicio: kill switches independientes y fail-open", () => {
  assert.ok(serviceSrc.includes('process.env.BACKUPS_ENABLED !== "false"'), "kill switch de backups");
  assert.ok(serviceSrc.includes('process.env.ORPHAN_SWEEP_ENABLED !== "false"'), "kill switch del sweep");
  assert.ok(serviceSrc.includes('from("platform_config")'), "estado persistido en platform_config");
  assert.ok(serviceSrc.includes("createBucket"), "bucket auto-creado");
  assert.ok(serviceSrc.includes(".upload("), "dump sube a storage");
  assert.ok(serviceSrc.includes(".remove("), "retención borra del bucket");
  assert.ok(serviceSrc.includes("cfg.smallTable"), "branch smallTable (tabla sin id) en exportTable");
});

test("servicio: resumen anidado, cada paso reporta el suyo", () => {
  assert.ok(serviceSrc.includes("summary.backup = await runBackupStep"), "backup anidado");
  assert.ok(serviceSrc.includes("summary.trashSweep = await runTrashSweepStep"), "sweep anidado");
  assert.ok(!serviceSrc.includes("Object.assign(summary,"), "no pisar status entre pasos");
});

test("worker: el mantenimiento corre AFUERA del guard de webhooks", () => {
  assert.ok(workerSrc.includes("from \"../api/src/services/platformMaintenance.js\""), "import del servicio");
  const maintCall = workerSrc.indexOf("runNightlyMaintenance(new Date())");
  const webhookGuard = workerSrc.indexOf("process.env.WEBHOOK_DISPATCH_SECRET");
  assert.ok(maintCall > -1, "llamada al mantenimiento presente");
  assert.ok(webhookGuard > -1, "guard de webhooks presente");
  assert.ok(maintCall < webhookGuard, "el mantenimiento DEBE correr antes del early-return del secret");
  assert.ok(workerSrc.includes("[maintenance-cron]"), "tag de log propio");
});

test("worker: el cron sigue entregando webhooks (no se rompió el sweep)", () => {
  assert.ok(workerSrc.includes("sweepWebhookDeliveries()"), "sweep intacto");
  assert.ok(workerSrc.includes("WEBHOOKS_TICK_ENABLED"), "kill switch de webhooks intacto");
});

// ── Nivel 2bis: caché de lectura pública del guest share ──

const shareSrc = readFileSync(join(ROOT, "api", "src", "routes", "commentShare.ts"), "utf8").replace(/\r\n/g, "\n");

test("commentShare: solo el 200 del GET lleva Cache-Control público", () => {
  assert.ok(
    shareSrc.includes('res.setHeader("Cache-Control", "public, max-age=120")'),
    "header presente en el camino de éxito",
  );
  const privateIdx = shareSrc.indexOf('code: "PRIVATE"');
  const headerIdx = shareSrc.indexOf("public, max-age=120");
  assert.ok(privateIdx > -1 && headerIdx > privateIdx, "el 403 PRIVATE vuelve antes, sin header");
});

test("worker: caché y purga del guest share cableadas en /api", () => {
  assert.ok(workerSrc.includes("SHARE_CACHE_RE"), "regex de URL cacheable");
  assert.ok(workerSrc.includes("SHARE_PURGE_RE"), "regex de URL a purgar");
  assert.ok(workerSrc.includes("cache.match(request.url)"), "lookup de edge cache");
  assert.ok(workerSrc.includes("cache.put(request.url"), "store tras 200 público");
  const cacheIdx = workerSrc.indexOf("cache.match(request.url)");
  const purgeIdx = workerSrc.indexOf("purgeGuestShare(url.host");
  const fetchIdx = workerSrc.indexOf("const res = await apiApp.fetch(request, env, ctx);\n        if (cache");
  assert.ok(cacheIdx > -1 && purgeIdx > -1 && fetchIdx > -1, "flujo match → purge → fetch → put");
  assert.ok(purgeIdx < fetchIdx, "la purga se dispara aunque la mutación falle");
});
