#!/usr/bin/env node
/**
 * import-capcut-draft.mjs — importador one-off de draft_content.json de CapCut
 * al modelo Musa Video (REQ-VID13). Sin UI: script CLI con dry-run por defecto.
 *
 * Mapeo (µs SIEMPRE — CapCut ya trabaja en microsegundos, pasan sin tocar):
 *   · canvas_config {width,height,ratio}  → canvas_w/canvas_h/ratio
 *   · materials dict {videos,audios,texts} → musa_video_materials (url/text)
 *   · tracks {video,audio,text}           → musa_video_tracks (z = orden)
 *   · segments target/source_timerange    → target_*_us / source_*_us
 *   · clip {transform,scale,rotation,alpha,flip} → clip normalizado
 *   · extra_material_refs de effects/stickers → material kind=effect
 *     (manifest {name,type,zorder,resources}) + extra_refs del segmento
 *   · textos "overlay" (solo extra_material_refs, sin track propio) →
 *     segmento sintetizado en el track de texto (timing del anfitrión)
 *   · texto doble-codificado (content JSON-string) → decodeDraftText
 *   · drafts encriptados → aviso + exit 2
 *
 * Uso:
 *   node scripts/import-capcut-draft.mjs --draft <draft_content.json> --workspace <wsId>
 *   node scripts/import-capcut-draft.mjs --draft ... --workspace ... --apply
 *
 * apply necesita SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (root .env, igual
 * que fetch-segment-models.mjs). Sin --apply solo imprime el reporte.
 */
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Misma forma que el service: prefijo + 12 hex. */
const genId = (prefix) => `${prefix}${randomBytes(6).toString("hex")}`;

const TRACK_TYPE_MAP = { video: "video", audio: "audio", text: "text" };
const MAX_REFS = 32;
const MAX_TEXT_LEN = 4_000;

const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));

/** URL importable por el modelo: http(s) o ruta absoluta POSIX (lo que
 *  validateMaterialPayload acepta). Rutas de disco Windows: importan igual
 *  pero quedan marcadas para subir a Storage antes del render. */
export function isImportableUrl(url) {
  return typeof url === "string" && /^(https?:\/\/|\/)/.test(url);
}

/**
 * Texto de CapCut suele venir doble-codificado: content es un JSON-string
 * que adentro tiene otro JSON {text}. Decodifica hasta objeto/string plano
 * (máx 3 pasadas) y devuelve text o null si es ilegible.
 */
export function decodeDraftText(raw) {
  let cur = raw;
  for (let i = 0; i < 3 && typeof cur === "string"; i++) {
    try {
      const next = JSON.parse(cur);
      if (typeof next === "string" || (next !== null && typeof next === "object")) cur = next;
      else break;
    } catch {
      break;
    }
  }
  if (cur !== null && typeof cur === "object" && !Array.isArray(cur)) {
    return typeof cur.text === "string" ? cur.text : null;
  }
  return typeof cur === "string" ? cur : null;
}

/** canvas_config → {canvasW, canvasH, ratio} (ratio "original" → w:h reducido). */
export function mapCanvas(canvasConfig) {
  const w = Math.min(8192, Math.max(16, Math.round(Number(canvasConfig?.width) || 1080)));
  const h = Math.min(8192, Math.max(16, Math.round(Number(canvasConfig?.height) || 1920)));
  const rawRatio = String(canvasConfig?.ratio ?? "").trim();
  let ratio = rawRatio;
  if (!ratio || ratio === "original") {
    const g = gcd(w, h) || 1;
    ratio = `${w / g}:${h / g}`.slice(0, 12);
  }
  return { canvasW: w, canvasH: h, ratio };
}

/** clip de CapCut → ClipTransform normalizado (x/y ∈ −1..1, scale uniforme
 *  = scale_x; anisotropía la avisa el caller). Null si no hay clip. */
export function mapClip(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const t = raw.transform && typeof raw.transform === "object" ? raw.transform : {};
  return {
    x: clamp(num(t.x, 0), -1, 1),
    y: clamp(num(t.y, 0), -1, 1),
    scale: clamp(num(raw.scale_x, 1), 0.01, 100),
    rotation: clamp(num(raw.rotation, 0), -3600, 3600),
    alpha: clamp(num(raw.alpha, 1), 0, 1),
    flip: raw.flip && typeof raw.flip === "object"
      ? { x: raw.flip.x === true, y: raw.flip.y === true }
      : null,
  };
}

const usInt = (v, min) => Math.max(min, Math.round(Number(v) || 0));

/**
 * Mapper puro draft_content.json → filas del modelo. No toca red ni disco.
 * Devuelve { project, tracks, materials, segments, warnings, localPaths } con
 * refs internas (ref/capcutTrackId) que el CLI resuelve a ids nuevos.
 */
export function mapDraft(draft, { name } = {}) {
  const warnings = [];
  const localPaths = [];
  const tracksOut = [];
  const materialsOut = [];
  const segmentsOut = [];

  const mats = draft.materials ?? {};
  const index = new Map(); // capcutId → { category, material }
  for (const category of ["videos", "audios", "texts", "stickers", "effects"]) {
    const arr = Array.isArray(mats[category]) ? mats[category] : [];
    for (const m of arr) {
      if (m && typeof m.id === "string") index.set(m.id, { category, material: m });
    }
  }

  const canvas = mapCanvas(draft.canvas_config);
  const keptTracks = (Array.isArray(draft.tracks) ? draft.tracks : []).filter((t) => {
    if (t && TRACK_TYPE_MAP[t.type]) return true;
    warnings.push(`Track tipo "${t?.type ?? "?"}" ignorado (solo video/audio/text).`);
    return false;
  });
  const trackRefByCapcutId = new Map(); // capcut track.id → ref nuevo
  keptTracks.forEach((t, z) => {
    const ref = genId("vidtrk_");
    trackRefByCapcutId.set(t.id, ref);
    tracksOut.push({ ref, type: TRACK_TYPE_MAP[t.type], z_order: z });
  });

  const project = {
    name: String(name ?? "").trim().slice(0, 120) || "Import CapCut",
    fps: Math.min(60, Math.max(1, Math.round(Number(draft.fps) || 30))),
    canvasW: canvas.canvasW,
    canvasH: canvas.canvasH,
    ratio: canvas.ratio,
  };

  // ── Material principal (videos/audios/texts): un material CapCut → UNO
  //    nuevo (un video usado en 3 clips sigue siendo un material). ──
  const mainById = new Map(); // capcutId → { ref, kind }
  const mainMaterialFor = (capcutId) => {
    const prev = mainById.get(capcutId);
    if (prev) return prev;
    const hit = index.get(capcutId);
    if (!hit) return null;
    const { category, material } = hit;
    let kind;
    let payload;
    if (category === "videos" || category === "audios") {
      kind = category === "videos" ? "video" : "audio";
      const url = String(material.path ?? material.url ?? "");
      payload = { url };
      if (Number.isFinite(Number(material.duration)) && Number(material.duration) > 0) {
        payload.durationUs = usInt(material.duration, 0); // µs passthrough
      }
      if (!isImportableUrl(url)) localPaths.push(url);
    } else if (category === "texts") {
      kind = "text";
      const text = decodeDraftText(material.content);
      if (text === null || !text.trim()) {
        warnings.push(`Texto ${capcutId}: contenido ilegible — omitido.`);
        return null;
      }
      if (text.length > MAX_TEXT_LEN) warnings.push(`Texto ${capcutId}: supera ${MAX_TEXT_LEN} caracteres — se corta.`);
      payload = { text: text.slice(0, MAX_TEXT_LEN) };
      if (Array.isArray(material.styles) && material.styles.length > 0) {
        warnings.push(`Texto "${text.slice(0, 24)}": estilos por rango ignorados (import v1).`);
      }
    } else {
      return null;
    }
    const ref = genId("vidmat_");
    mainById.set(capcutId, { ref, kind });
    materialsOut.push({ ref, kind, payload });
    return { ref, kind };
  };

  // ── Companions kind=effect (effects/stickers referenciados) ──
  const companionRefFor = (capcutId) => {
    const hit = index.get(capcutId);
    if (!hit) return null;
    const isSticker = hit.category === "stickers";
    const manifest = {
      name: String(hit.material?.name ?? capcutId).slice(0, 120) || capcutId,
      type: isSticker ? "draft:sticker" : "draft:effect",
      zorder: 90 + materialsOut.length % 1000,
      resources: typeof hit.material?.resource_path === "string"
        ? { path: hit.material.resource_path.slice(0, 500) }
        : {},
    };
    const ref = genId("vidmat_");
    materialsOut.push({ ref, kind: "effect", payload: { manifest, params: {}, builtin: false } });
    return ref;
  };

  const usedAsMain = new Set();
  for (const t of keptTracks) {
    for (const seg of Array.isArray(t.segments) ? t.segments : []) {
      if (seg?.material_id) usedAsMain.add(seg.material_id);
    }
  }

  // Timing heredado para textos overlay (solo viven en extra_material_refs).
  const overlayTiming = new Map(); // capcutTextId → { start, dur }

  for (const t of keptTracks) {
    for (const seg of Array.isArray(t.segments) ? t.segments : []) {
      const main = mainMaterialFor(seg?.material_id);
      if (!main) continue; // avisado en mainMaterialFor
      const tt = seg.target_timerange ?? {};
      const st = seg.source_timerange;
      const speed = Number(seg.speed) > 0 ? Number(seg.speed) : 1;
      const clip = mapClip(seg.clip);
      if (clip && Number.isFinite(Number(seg.scale_x)) && Number.isFinite(Number(seg.scale_y))
        && Math.abs(Number(seg.scale_x) - Number(seg.scale_y)) > 0.01) {
        warnings.push(`Segmento ${seg.id ?? "?"}: scale_x≠scale_y — se importa scale_x (uniforme).`);
      }
      const extraRefs = [];
      for (const refId of Array.isArray(seg.extra_material_refs) ? seg.extra_material_refs : []) {
        const hit = index.get(refId);
        if (!hit) continue;
        if (hit.category === "effects" || hit.category === "stickers") {
          const ref = companionRefFor(refId);
          if (ref && !extraRefs.includes(ref)) extraRefs.push(ref);
        } else if (hit.category === "texts" && !usedAsMain.has(refId)) {
          overlayTiming.set(refId, {
            start: usInt(tt.start, 0),
            dur: Math.max(1, usInt(tt.duration, 1_000_000)),
          });
        }
      }
      if (extraRefs.length > MAX_REFS) warnings.push(`Segmento ${seg.id ?? "?"}: ${extraRefs.length} refs > cap ${MAX_REFS} — se cortan.`);
      segmentsOut.push({
        capcutTrackId: trackRefByCapcutId.get(t.id),
        materialRef: main.ref,
        target_start_us: usInt(tt.start, 0),
        target_dur_us: Math.max(1, usInt(tt.duration, 1)),
        source_start_us: st && Number.isFinite(Number(st.start)) ? usInt(st.start, 0) : null,
        source_dur_us: st && Number.isFinite(Number(st.duration)) ? Math.max(1, usInt(st.duration, 1)) : null,
        speed,
        clip,
        extraRefs: extraRefs.slice(0, MAX_REFS),
      });
    }
  }

  // ── Textos overlay: sin track propio → segmento sintetizado ──
  const overlayTexts = [...index.values()].filter(
    ({ category, material }) => category === "texts" && !usedAsMain.has(material.id),
  );
  if (overlayTexts.length > 0) {
    let textTrackRef = tracksOut.find((t) => t.type === "text")?.ref;
    if (!textTrackRef) {
      textTrackRef = genId("vidtrk_");
      tracksOut.push({ ref: textTrackRef, type: "text", z_order: tracksOut.length });
      warnings.push("Texto overlay sin track de texto: track sintetizado.");
    }
    for (const { material } of overlayTexts) {
      const main = mainMaterialFor(material.id);
      if (!main) continue;
      const tm = overlayTiming.get(material.id) ?? { start: 0, dur: 3_000_000 };
      segmentsOut.push({
        capcutTrackId: textTrackRef,
        materialRef: main.ref,
        target_start_us: tm.start,
        target_dur_us: tm.dur,
        source_start_us: null,
        source_dur_us: null,
        speed: 1,
        clip: null,
        extraRefs: [],
      });
    }
    warnings.push(`${overlayTexts.length} texto(s) overlay sintetizado(s) en el track de texto.`);
  }

  // Caps del modelo (VIDEO_LIMITS): aviso + corte.
  if (tracksOut.length > 32) warnings.push(`${tracksOut.length} tracks > cap 32 — se cortan.`);
  if (materialsOut.length > 2_000) warnings.push(`${materialsOut.length} materials > cap 2000 — se cortan.`);
  let endUs = 0;
  for (const s of segmentsOut) endUs = Math.max(endUs, s.target_start_us + s.target_dur_us);

  const refIndex = new Map(materialsOut.map((m) => [m.ref, m]));
  return {
    project: { ...project, durationUs: endUs },
    tracks: tracksOut.slice(0, 32),
    materials: materialsOut.slice(0, 2_000).map((m) => refIndex.get(m.ref)).filter(Boolean),
    segments: segmentsOut.filter((s) => s.capcutTrackId && refIndex.has(s.materialRef)),
    warnings,
    localPaths,
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--draft") args.draft = argv[++i];
    else if (a === "--workspace") args.workspace = argv[++i];
    else if (a === "--name") args.name = argv[++i];
    else if (a === "--apply") args.apply = true;
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

function loadEnv() {
  const env = { ...process.env };
  try {
    for (const line of readFileSync(join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* sin .env: solo process.env */ }
  return env;
}

function printReport(mapped) {
  console.log("\n┌─ Reporte de import (dry-run) ─────────────────────────");
  console.log(`│ Proyecto : ${mapped.project.name} · ${mapped.project.canvasW}×${mapped.project.canvasH} ${mapped.project.ratio} · ${mapped.project.fps} fps`);
  console.log(`│ Duración : ${mapped.project.durationUs} µs (fin del contenido)`);
  console.log(`│ Tracks   : ${mapped.tracks.map((t) => `${t.type}@z${t.z_order}`).join(", ") || "—"}`);
  console.log(`│ Materials: ${mapped.materials.length} (${mapped.materials.filter((m) => m.kind === "effect").length} efectos, ${mapped.materials.filter((m) => m.kind === "text").length} textos)`);
  console.log(`│ Segments : ${mapped.segments.length}`);
  for (const w of mapped.warnings) console.log(`│ ⚠ ${w}`);
  for (const p of mapped.localPaths) console.log(`│ ⚠ ruta local (subir a Storage antes del render): ${p}`);
  console.log("└───────────────────────────────────────────────────────");
  console.log("\nPrimeras filas (dry-run):");
  console.log(JSON.stringify({
    project: mapped.project,
    tracks: mapped.tracks,
    materials: mapped.materials.slice(0, 8),
    segments: mapped.segments.slice(0, 8),
  }, null, 2));
}

async function applyRows(mapped, workspaceId) {
  const env = loadEnv();
  const base = String(env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
  if (!base || !key) {
    console.error("[import] apply necesita SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (root .env).");
    process.exit(1);
  }
  const H = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  const post = async (table, rows) => {
    const r = await fetch(`${base}/rest/v1/${table}`, { method: "POST", headers: H, body: JSON.stringify(rows) });
    if (!r.ok) throw new Error(`${table}: HTTP ${r.status} — ${(await r.text()).slice(0, 400)}`);
    return r.json();
  };

  const projectId = genId("vidproj_");
  await post("musa_video_projects", [{
    id: projectId,
    workspace_id: workspaceId,
    name: mapped.project.name,
    duration_us: mapped.project.durationUs,
    fps: mapped.project.fps,
    canvas_w: mapped.project.canvasW,
    canvas_h: mapped.project.canvasH,
    ratio: mapped.project.ratio,
    is_template: false,
    created_by: "user",
  }]);
  console.log(`[import] project ${projectId} OK`);
  if (mapped.tracks.length > 0) {
    await post("musa_video_tracks", mapped.tracks.map((t) => ({
      id: t.ref, project_id: projectId, type: t.type, z_order: t.z_order,
    })));
    console.log(`[import] tracks (${mapped.tracks.length}) OK`);
  }
  await post("musa_video_materials", mapped.materials.map((m) => ({
    id: m.ref, project_id: projectId, kind: m.kind, payload: m.payload, slot: null,
  })));
  console.log(`[import] materials (${mapped.materials.length}) OK`);
  if (mapped.segments.length > 0) {
    await post("musa_video_segments", mapped.segments.map((s) => ({
      id: genId("vidseg_"),
      track_id: s.capcutTrackId,
      material_id: s.materialRef,
      target_start_us: s.target_start_us,
      target_dur_us: s.target_dur_us,
      source_start_us: s.source_start_us,
      source_dur_us: s.source_dur_us,
      speed: s.speed,
      clip: s.clip,
      extra_refs: s.extraRefs,
    })));
    console.log(`[import] segments (${mapped.segments.length}) OK`);
  }
  console.log(`\n[import] Listo: abrí #video/${projectId}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.draft || !args.workspace) {
    console.log("Uso: node scripts/import-capcut-draft.mjs --draft <draft_content.json> --workspace <wsId> [--name <nombre>] [--apply]");
    process.exit(args.help ? 0 : 1);
  }
  let draft;
  try {
    draft = JSON.parse(readFileSync(args.draft, "utf8"));
  } catch {
    console.error("[import] El draft no es JSON legible — los CapCut nuevos CIFRAN draft_content.json.");
    console.error("[import] Exportá el proyecto sin cifrado (versión anterior de CapCut) o pedí el draft a quien lo creó. Abortado.");
    process.exit(2);
  }
  const fallbackName = basename(dirname(resolve(args.draft)));
  const mapped = mapDraft(draft, { name: args.name || fallbackName });
  printReport(mapped);
  if (!args.apply) {
    console.log("\n[import] dry-run: no se escribió nada (pasá --apply para insertar).");
    return;
  }
  await applyRows(mapped, args.workspace);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
