// REQ-058 — TTL 24 h / cupo de tomas y helpers del recorder. Run with:
// node --experimental-strip-types --test QA/take-ttl.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import {
  TAKES_SOFT_QUOTA_BYTES,
  TAKE_TTL_MS,
  canDownloadTake,
  canUploadTake,
  computeExpiresAtMs,
  humanBytes,
  humanRemaining,
  takeFilename,
  takeStatus,
} from "../shared/takeTtl.ts";
import { MAX_TAKE_DURATION_MS, MIME_CANDIDATES, formatElapsed, pickRecorderMime } from "../src/lib/takeRecorder.ts";

const HOUR = 3_600_000;

test("constantes del producto: TTL 24 h, cupo 8 GB, tope 3 min", () => {
  assert.equal(TAKE_TTL_MS, 24 * HOUR);
  assert.equal(TAKES_SOFT_QUOTA_BYTES, 8 * 1024 * 1024 * 1024);
  assert.equal(MAX_TAKE_DURATION_MS, 3 * 60_000);
});

test("takeStatus: ready viva → countdown legible; uploading cuenta igual", () => {
  const now = 1_000_000_000_000;
  const ready = takeStatus("ready", now + 23 * HOUR + 12 * 60_000, now);
  assert.equal(ready.status, "ready");
  assert.equal(ready.expired, false);
  assert.equal(ready.label, "23 h 12 min");
  const uploading = takeStatus("uploading", now + 5 * 60_000, now);
  assert.equal(uploading.status, "uploading");
  assert.equal(uploading.expired, false);
});

test("takeStatus: vencida (lazy) y purgada", () => {
  const now = 1_000_000_000_000;
  const expired = takeStatus("ready", now, now);
  assert.equal(expired.status, "expired");
  assert.equal(expired.expired, true);
  assert.equal(expired.remainingMs, 0);
  assert.equal(expired.label, "vencida");
  const purged = takeStatus("purged", now + HOUR, now);
  assert.equal(purged.status, "purged");
  assert.equal(purged.expired, true);
});

test("humanRemaining: formatos sin emojis", () => {
  assert.equal(humanRemaining(59_999), "< 1 min");
  assert.equal(humanRemaining(8 * 60_000), "8 min");
  assert.equal(humanRemaining(23 * HOUR + 5 * 60_000), "23 h 05 min");
  assert.equal(humanRemaining(0), "vencida");
  assert.equal(humanRemaining(-1), "vencida");
});

test("canUploadTake: size requerido y cupo blando por bytes vivos", () => {
  assert.deepEqual(canUploadTake(0, 0), { ok: false, reason: "TAKE_SIZE_REQUIRED" });
  assert.deepEqual(canUploadTake(0, -5), { ok: false, reason: "TAKE_SIZE_REQUIRED" });
  const quota = TAKES_SOFT_QUOTA_BYTES;
  assert.deepEqual(canUploadTake(quota - 100, 100), { ok: true });
  assert.deepEqual(canUploadTake(quota - 100, 101), { ok: false, reason: "TAKE_QUOTA_EXCEEDED" });
  // Bytes vencidos no ocupan cupo (el caller ya los filtró, pero el límite es sobre vivos).
  assert.deepEqual(canUploadTake(quota, 0), { ok: false, reason: "TAKE_SIZE_REQUIRED" });
});

test("canDownloadTake: solo ready y viva — la promesa de 24 h aunque el sweep no corra", () => {
  const now = 1_000_000_000_000;
  assert.equal(canDownloadTake("ready", now + 1, now), true);
  assert.equal(canDownloadTake("ready", now, now), false);
  assert.equal(canDownloadTake("uploading", now + HOUR, now), false);
  assert.equal(canDownloadTake("purged", now + HOUR, now), false);
});

test("computeExpiresAtMs y takeFilename: server decides, nombre ordenable", () => {
  const created = Date.UTC(2026, 9, 25, 10, 30, 15);
  assert.equal(computeExpiresAtMs(created), created + TAKE_TTL_MS);
  // La fecha se construye en hora local del server — verificamos el formato.
  assert.match(takeFilename(created), /^toma-\d{8}-\d{6}\.webm$/);
  assert.match(takeFilename(created, "mp4"), /^toma-\d{8}-\d{6}\.mp4$/);
});

test("humanBytes: KB/MB/GB legibles", () => {
  assert.equal(humanBytes(0), "0 MB");
  assert.equal(humanBytes(512 * 1024), "512 KB");
  assert.equal(humanBytes(42 * 1024 * 1024), "42 MB");
  assert.equal(humanBytes(1.5 * 1024 * 1024 * 1024), "1.5 GB");
});

test("pickRecorderMime: preferencia VP9 → VP8 → WebM → MP4; null si nada", () => {
  const all = pickRecorderMime(() => true);
  assert.equal(all?.mime, MIME_CANDIDATES[0].mime);
  const noVp9 = pickRecorderMime(m => m === "video/webm" || m === "video/mp4");
  assert.equal(noVp9?.ext, "webm");
  const onlyMp4 = pickRecorderMime(m => m === "video/mp4");
  assert.equal(onlyMp4?.ext, "mp4");
  assert.equal(pickRecorderMime(() => false), null);
});

test("formatElapsed: cronómetro de la UI", () => {
  assert.equal(formatElapsed(0), "0:00");
  assert.equal(formatElapsed(7_400), "0:07");
  assert.equal(formatElapsed(151_000), "2:31");
  assert.equal(formatElapsed(-5), "0:00");
});
