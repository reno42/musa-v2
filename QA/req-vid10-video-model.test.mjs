// QA/req-vid10-video-model.test.mjs — REQ-VID10 modelo video standalone.
// Lo puro (validadores CapCut) se testea de verdad importándolo; el despacho
// MCP, la migración v73 y los contratos REST se afirman sobre el source
// (convención del repo: req027-flows-mcp / req032-photo-mcp). Corre con:
//   node --experimental-strip-types --test QA/req-vid10-video-model.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BUILTIN_VIDEO_EFFECTS,
  VIDEO_LIMITS,
  VIDEO_MATERIAL_KINDS,
  VIDEO_TRACK_TYPES,
  VideoProjectError,
  builtinEffectById,
  normalizeClipTransform,
  projectDurationUs,
  resolveEffectPayload,
  sourceDurForTarget,
  targetDurForSource,
  validateDurUs,
  validateMaterialPayload,
  validateSpeed,
  validateUsInt,
} from "../api/src/services/videoProjects.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const mcpSource = readFileSync(ROOT + "netlify/functions/mcp.mjs", "utf8");
const migration = readFileSync(ROOT + "supabase_migrations_v73.sql", "utf8");
const apiIndexSource = readFileSync(ROOT + "api/src/index.ts", "utf8");
const routesSource = readFileSync(ROOT + "api/src/routes/videoProjects.ts", "utf8");
let catalog = []; // tools_catalog.json es un array plano de {name, description, inputSchema}
try {
  catalog = JSON.parse(readFileSync(ROOT + "tools_catalog.json", "utf8"));
} catch { /* se regenera con sync:skill */ }

// ── Reglas duras de CapCut: tiempo en µs ────────────────────────────────────

test("VID10 µs: validateUsInt exige enteros ≥ min y rechaza fracciones/negativos", () => {
  assert.equal(validateUsInt(1_500_000, "t"), 1_500_000);
  assert.equal(validateUsInt(0, "t"), 0);
  // fracción = bug del caller (no se redondea en silencio)
  assert.throws(() => validateUsInt(1.5, "t"), /TIME_INVALID/);
  // negativo fuera de rango
  assert.throws(() => validateUsInt(-1, "t"), /TIME_INVALID/);
  // string de segundos: rechazado — 1s = 1000000
  assert.throws(() => validateUsInt("2s", "t"), /TIME_INVALID/);
  assert.match(String(validateUsInt(1_500_000, "t")), /^1500000$/);
});

test("VID10 µs: validateDurUs exige > 0; validateSpeed clampea a (0.01, 100] y defaultea 1", () => {
  assert.equal(validateDurUs(500_000, "d"), 500_000);
  assert.throws(() => validateDurUs(0, "d"), /TIME_INVALID/);
  assert.equal(validateSpeed(undefined), 1);
  assert.equal(validateSpeed(2), 2);
  assert.throws(() => validateSpeed(0), /SPEED_INVALID/);
  assert.throws(() => validateSpeed(-1), /SPEED_INVALID/);
  assert.equal(validateSpeed(1000), VIDEO_LIMITS.maxSpeed);
});

test("VID10 regla de oro: source_dur = round(target_dur × speed) y su inversa", () => {
  assert.equal(sourceDurForTarget(1_000_000, 1), 1_000_000);
  assert.equal(sourceDurForTarget(1_000_000, 2), 2_000_000); // speed 2.0 ⇒ source = 2× target
  assert.equal(sourceDurForTarget(1_500_000, 3), 4_500_000);
  assert.equal(targetDurForSource(2_000_000, 2), 1_000_000);
  assert.equal(targetDurForSource(1, 100), 1); // mínimo 1 µs
});

test("VID10 duration del project = max(target_start + target_dur)", () => {
  assert.equal(projectDurationUs([]), 0);
  assert.equal(projectDurationUs([
    { target_start_us: 0, target_dur_us: 2_000_000 },
    { target_start_us: 1_500_000, target_dur_us: 3_000_000 },
  ]), 4_500_000);
});

// ── clip transform: posiciones -1..1, audio prohibido en el caller ──────────

test("VID10 clip: normaliza y clampea (x,y ∈ -1..1, scale, alpha 0..1, rotation)", () => {
  assert.equal(normalizeClipTransform(null), null);
  assert.equal(normalizeClipTransform(undefined), null);
  const c = normalizeClipTransform({ x: 5, y: -7, scale: 0, rotation: 9999, alpha: 3, flip: { x: true } });
  assert.deepEqual(c, { x: 1, y: -1, scale: 0.01, rotation: 3600, alpha: 1, flip: { x: true, y: false } });
  const def = normalizeClipTransform({});
  assert.deepEqual(def, { x: 0, y: 0, scale: 1, rotation: 0, alpha: 1, flip: null });
  // flip vacío → null (no ocupa JSONB al vane)
  assert.equal(normalizeClipTransform({ flip: {} }).flip, null);
  assert.throws(() => normalizeClipTransform("boom"), /CLIP_INVALID/);
  assert.throws(() => normalizeClipTransform([1]), /CLIP_INVALID/);
});

// ── Materials: payload por kind, texto por RANGOS, cap de tamaño ────────────

test("VID10 payload video/audio exige url y valida durationUs en µs", () => {
  assert.throws(() => validateMaterialPayload("video", { noUrl: true }), /PAYLOAD_INVALID/);
  const ok = validateMaterialPayload("video", { url: "https://x/y.mp4", durationUs: 3_500_000 });
  assert.equal(ok.durationUs, 3_500_000);
  assert.throws(() => validateMaterialPayload("audio", { url: "https://x.mp3", durationUs: 1.5 }), /TIME_INVALID/);
});

test("VID10 payload text: estilado por rangos de caracteres, no blob", () => {
  assert.throws(() => validateMaterialPayload("text", {}), /PAYLOAD_INVALID/);
  const ok = validateMaterialPayload("text", {
    text: "Hola mundo",
    ranges: [{ start: 0, end: 4, style: { color: "#f00" } }],
  });
  assert.equal(ok.ranges.length, 1);
  assert.throws(() => validateMaterialPayload("text", { text: "x", ranges: [{ start: 4, end: 4 }] }), /PAYLOAD_INVALID/);
  assert.throws(() => validateMaterialPayload("text", { text: "x", ranges: [{ start: 0, end: 2, style: "nope" }] }), /PAYLOAD_INVALID/);
});

test("VID10 payload cap 64KB — los binarios jamás en JSONB", () => {
  const big = { url: "https://x/y.mp4", junk: "a".repeat(VIDEO_LIMITS.payloadBytes + 10) };
  assert.throws(() => validateMaterialPayload("video", big), /PAYLOAD_TOO_LARGE/);
});

test("VID10 kinds y track types cubren el modelo CapCut", () => {
  assert.deepEqual(VIDEO_MATERIAL_KINDS, [
    "video", "audio", "text", "sticker", "effect", "transition",
    "animation", "mask", "canvas", "speed", "audio_fade",
  ]);
  assert.deepEqual([...VIDEO_TRACK_TYPES], ["video", "audio", "text", "sticker", "effect"]);
});

// ── Efectos (VID14): manifest estilo lumi, builtin fase 1 sin shader ────────

test("VID14 efectos: builtin conocido resuelve manifest con params; desconocido da código estable", () => {
  const r = resolveEffectPayload("fx-lut", undefined, { css: "saturate(1.2)" });
  assert.equal(r.builtin, true);
  assert.equal(r.manifest.name, "fx-lut");
  assert.equal(r.manifest.type, "AmazingFeature");
  assert.equal(builtinEffectById("nope"), null);
  assert.throws(() => resolveEffectPayload("nope", undefined, {}), /EFFECT_UNKNOWN/);
  // los 4 builtin fase 1: overlay, lut, texto animado, sticker con keyframes
  assert.deepEqual(BUILTIN_VIDEO_EFFECTS.map((e) => e.id).sort(),
    ["fx-lut", "fx-overlay", "fx-sticker-kf", "fx-text-anim"]);
});

test("VID14 efectos: manifest crudo exige {name, type} estilo lumi", () => {
  const r = resolveEffectPayload(undefined, { name: "community-fx", type: "InfoSticker", zorder: 10 }, {});
  assert.equal(r.builtin, false);
  assert.equal(r.manifest.zorder, 10);
  assert.throws(() => resolveEffectPayload(undefined, { name: "x" }, {}), /EFFECT_MANIFEST_INVALID/);
  assert.throws(() => resolveEffectPayload(undefined, undefined, {}), /EFFECT_TARGET_INVALID/);
});

// ── Errores con código estable (la IA se autocorrige) ───────────────────────

test("VID10 VideoProjectError trae code + status", () => {
  const e = new VideoProjectError("SPEED_MISMATCH", "boom", 400);
  assert.equal(e.code, "SPEED_MISMATCH");
  assert.equal(e.status, 400);
  assert.ok(e instanceof Error);
});

// ── Contratos sobre source (mismo bracket-scan que la convención) ───────────

const VIDEO_TOOLS = [
  "video_project_create", "video_project_list", "video_project_get", "video_project_delete",
  "video_track_add", "video_material_add",
  "video_segment_add", "video_segment_move", "video_segment_trim", "video_segment_transform", "video_segment_delete",
  "video_effect_apply", "video_template_register", "video_template_instantiate",
  "video_render",
];
const VIDEO_READ_TOOLS = ["video_project_list", "video_project_get"];

test("VID10 MCP: los 15 tools están declarados en MCP_TOOLS con schema µs", () => {
  for (const name of VIDEO_TOOLS) {
    assert.match(mcpSource, new RegExp(`name: "${name}"`), `falta tool ${name}`);
  }
  // la regla de oro y la prohibición de segundos se documentan EN el schema
  assert.match(mcpSource, /source_dur = target_dur × speed/);
  assert.match(mcpSource, /MICROSEGUNDOS \(1s = 1000000\)/);
});

test("VID10 MCP: cada tool tiene su case en el dispatch que llama al servicio compartido", () => {
  const dispatch = mcpSource.slice(mcpSource.indexOf("switch (method)"));
  for (const name of VIDEO_TOOLS) {
    assert.ok(dispatch.includes(`case "${name}"`), `falta case ${name} en el dispatch`);
  }
  assert.ok(dispatch.includes("videoProjects.createVideoProject"));
  assert.ok(dispatch.includes("videoProjects.addVideoSegment"));
  assert.ok(dispatch.includes("videoProjects.applyVideoEffect"));
  assert.ok(dispatch.includes("videoProjects.instantiateVideoTemplate"));
});

test("VID10 MCP: video_render falla CLARO (RENDER_PENDING) — nunca éxito falso", () => {
  const caseBody = mcpSource.slice(mcpSource.indexOf('case "video_render"'));
  const nextCase = caseBody.indexOf("case ", 10);
  const body = caseBody.slice(0, nextCase);
  assert.match(body, /RENDER_PENDING/);
  assert.match(body, /throw \{ code: -32000/);
});

test("VID10 MCP: tenant de projectId se resuelve en DB (VIDEO_TENANT_METHODS) anti cross-tenant", () => {
  assert.match(mcpSource, /const VIDEO_TENANT_METHODS = new Set\(/);
  for (const name of VIDEO_TOOLS.filter((t) => !["video_project_create", "video_project_list"].includes(t))) {
    assert.ok(mcpSource.match(new RegExp(`VIDEO_TENANT_METHODS[\\s\\S]*?"${name}"`)), `${name} falta en VIDEO_TENANT_METHODS`);
  }
  // resuelve el workspace del ROW y rechaza si cruza tenant
  assert.match(mcpSource, /Video project belongs to another workspace/);
  // read tools → viewer por el prefijo MCP_READ_PREFIX (get|list); sin set extra
  assert.match(mcpSource, /const MCP_READ_PREFIX = \/.*\(get\|list\|/);
});

test("VID10 MCP: videoTool mapea VideoProjectError a JSON-RPC con código estable", () => {
  assert.match(mcpSource, /function videoTool\(fn\)/);
  assert.match(mcpSource, /instanceof videoProjects\.VideoProjectError/);
  assert.match(mcpSource, /import \* as videoProjects from "\.\.\/\.\.\/api\/src\/services\/videoProjects\.js";/);
});

// ── Migración v73: tablas, µs BIGINT, CHECKs y RLS ──────────────────────────

test("VID10 migración v73: las 4 tablas musa_video_* con ids prefijados", () => {
  for (const table of ["musa_video_projects", "musa_video_tracks", "musa_video_segments", "musa_video_materials"]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`));
    const prefix = { musa_video_projects: "vidproj", musa_video_tracks: "vidtrk", musa_video_segments: "vidseg", musa_video_materials: "vidmat" }[table];
    assert.match(migration, new RegExp(`${table}_id_prefix CHECK \\(id LIKE '${prefix}`));
  }
});

test("VID10 migración v73: tiempo SIEMPRE BIGINT µs — prohibido segundos", () => {
  for (const col of ["duration_us", "target_start_us", "target_dur_us", "source_start_us", "source_dur_us"]) {
    assert.match(migration, new RegExp(`${col} BIGINT`), `falta ${col} BIGINT`);
  }
  assert.ok(!/_sec\b/.test(migration), "la migración no debe tener columnas en segundos");
});

test("VID10 migración v73: CHECKs de formato (speed > 0, µs ≥ 0, kind enum, target_dur > 0)", () => {
  assert.match(migration, /speed REAL NOT NULL DEFAULT 1\.0 CHECK \(speed > 0\)/);
  assert.match(migration, /target_dur_us BIGINT NOT NULL CHECK \(target_dur_us > 0\)/);
  assert.match(migration, /duration_us BIGINT NOT NULL DEFAULT 0 CHECK \(duration_us >= 0\)/);
  assert.match(migration, /type TEXT NOT NULL CHECK \(type IN \('video', 'audio', 'text', 'sticker', 'effect'\)\)/);
  for (const kind of VIDEO_MATERIAL_KINDS) {
    assert.ok(migration.includes(`'${kind}'`), `falta kind ${kind} en el CHECK`);
  }
});

test("VID10 migración v73: audio ⇒ clip NULL documentado; companions sin FK (integridad en servicio)", () => {
  assert.match(migration, /audio crashea/); // regla dura documentada en el header
  assert.match(migration, /material_id TEXT NOT NULL,/); // SIN REFERENCES — companions por referencia
  assert.match(migration, /extra_refs TEXT\[\] NOT NULL DEFAULT '\{\}'/);
});

test("VID10 migración v73: RLS viewer lee / editor escribe en las 4 tablas", () => {
  for (const table of ["musa_video_projects", "musa_video_tracks", "musa_video_segments", "musa_video_materials"]) {
    assert.match(migration, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(migration, new RegExp(`viewer can read ${table}`));
    assert.match(migration, new RegExp(`editor can write ${table}`));
  }
  assert.match(migration, /has_workspace_role/);
});

test("VID10 migración v73: idempotente (IF NOT EXISTS en tablas e índices)", () => {
  assert.ok(!/CREATE TABLE (?![A-Za-z_ ]*IF NOT EXISTS)/m.test(migration.replace(/CREATE TABLE IF NOT EXISTS/g, "")));
  const createIdx = migration.match(/CREATE INDEX/g) || [];
  const createIdxIfNot = migration.match(/CREATE INDEX IF NOT EXISTS/g) || [];
  assert.equal(createIdx.length, createIdxIfNot.length, "todo índice debe ser IF NOT EXISTS");
});

// ── REST /api/video-projects: mismo servicio, gate por ROW ──────────────────

test("VID10 REST: el router se monta con requireUserSession en /api/video-projects", () => {
  assert.match(apiIndexSource, /import \{ videoProjectRoutes \} from "\.\/routes\/videoProjects\.js";/);
  assert.match(apiIndexSource, /app\.use\("\/api\/video-projects", requireUserSession, videoProjectRoutes\)/);
});

test("VID10 REST: gate por rol del ROW (viewer GET / editor escritura), tenant nunca del input", () => {
  assert.match(routesSource, /tree\.project\.workspace_id/);
  assert.match(routesSource, /canAccessWorkspace\(req\.auth, tree\.project\.workspace_id, minimum\)/);
  assert.match(routesSource, /gate\(req, res, "viewer"\)/);
  assert.match(routesSource, /gate\(req, res, "editor"\)/);
  // PATCH = move|trim|transform sobre el MISMO segment (router express, minúscula)
  assert.match(routesSource, /\.patch\("\/:projectId\/segments\/:segmentId"/);
  assert.match(routesSource, /moveVideoSegment/);
  assert.match(routesSource, /trimVideoSegment/);
  assert.match(routesSource, /transformVideoSegment/);
});

// ── Catálogo sincronizado (sync:skill regenera tools_catalog.json) ──────────

test("VID10 MCP: tools_catalog.json incluye el módulo video_* (post sync:skill)", () => {
  const tools = Array.isArray(catalog) ? catalog : catalog.tools || [];
  const names = new Set(tools.map((t) => t.name));
  for (const name of VIDEO_TOOLS) {
    assert.ok(names.has(name), `falta ${name} en tools_catalog.json — corre npm run sync:skill`);
  }
});

// ── VID7 pre-requisito: el fix REQ-014 sigue en su sitio ────────────────────

test("VID7: set_animation sigue chequeando el retorno de updateTemplate (REQ-014 no regresa)", () => {
  assert.match(mcpSource, /REQ-014: a null return means the Supabase upsert failed/);
  assert.match(mcpSource, /ANIMATION_SAVE_FAILED/);
});
