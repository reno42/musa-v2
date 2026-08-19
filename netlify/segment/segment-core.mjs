// ═══════════════════════════════════════════════════════════════════
// segment-core.mjs — ONNX segmentation engine (calado / máscaras)
// ═══════════════════════════════════════════════════════════════════
// Runs inside netlify/functions/image-segment-background.mjs (Netlify
// BACKGROUND function: 15-min budget, WASM runtime onnxruntime-web +
// sharp). ZERO LLM tokens — every mask comes from a local ONNX model:
//
//   remove_background  u2netp     (rembg, 320×320, ~1s CPU)
//   segment_click      MobileSAM  (clicks + box prompts, 1024, ~2-4s)
//   segment_text       CLIPSeg    (text prompt, 352, ~5-15s int8)
//
// Weights live in the public `ml-models` Supabase bucket (provisioned
// by supabase_migrations/musa_segment.sql + scripts/fetch-segment-models.mjs),
// cached in /tmp across warm invocations. In local dev, ./models-cache/
// (gitignored) takes precedence so the engine runs without the bucket.
//
// Job state lives in the `segment_jobs` table: HTTP entry points (REST +
// MCP) insert a queued row, dispatch the background function and poll.
// ═══════════════════════════════════════════════════════════════════
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve as pathResolve, dirname as pathDirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as ort from "onnxruntime-web";
import sharp from "sharp";
import { ClipTokenizer } from "./clip-bpe.mjs";

// api/src services are TypeScript — the ".js" specifier only resolves after
// esbuild bundling (Netlify). Imported lazily so the pure-inference paths
// (selfTest, local experiments) run under plain `node` without a bundler.
async function sbService() {
  return import("../../api/src/services/supabase.js");
}

// Netlify empaqueta las funciones como CJS: ahí import.meta.url queda VACÍO
// (fileURLToPath(undefined) trona), mientras que en `node` local (ESM) no
// existe __dirname. El typeof cubre ambos mundos sin sombrear el global CJS.
const __dir = typeof __dirname === "string"
  ? __dirname
  : pathDirname(fileURLToPath(import.meta.url));
const ROOT = pathResolve(__dir, "../..");

// ── WASM runtime bootstrap ─────────────────────────────────────────
// onnxruntime-web queda EXTERNO al bundle (external_node_modules): dentro
// del zip vive en <raíz>/node_modules. Cargamos el binario
// ort-wasm-simd-threaded.wasm en memoria (env.wasm.wasmBinary) para que el
// runtime no dependa de fetch/file:// (undici no soporta file://) y un solo
// hilo evita SharedArrayBuffer/workers en el sandbox serverless. En Lambda
// cwd = <raíz del zip> y el bundle CJS corre en <raíz>/netlify/functions/.
const WASM_CANDIDATES = [
  pathResolve(process.cwd(), "node_modules", "onnxruntime-web", "dist", "ort-wasm-simd-threaded.wasm"),
  pathResolve(__dir, "..", "..", "node_modules", "onnxruntime-web", "dist", "ort-wasm-simd-threaded.wasm"),
  pathResolve(__dir, "node_modules", "onnxruntime-web", "dist", "ort-wasm-simd-threaded.wasm"),
  pathResolve(__dir, "..", "node_modules", "onnxruntime-web", "dist", "ort-wasm-simd-threaded.wasm"),
];
const wasmFile = WASM_CANDIDATES.find(p => existsSync(p));
if (wasmFile) ort.env.wasm.wasmBinary = readFileSync(wasmFile);
ort.env.wasm.numThreads = 1;
ort.env.logLevel = "warning";
// ══════════════════════════════════════════════════════════════════

// ── Model registry ────────────────────────────────────────────────
const MODEL_FILES = {
  u2netp: "u2netp.onnx",
  samEncoder: "mobile_sam_encoder.onnx",
  samDecoder: "mobile_sam_decoder.onnx",
  clipseg: "clipseg-rd64-int8.onnx",
  clipVocab: "clipseg-vocab.json",
  clipMerges: "clipseg-merges.txt",
};

const sessionCache = new Map(); // name → InferenceSession (warm invocations)
const tokenizerCache = { tok: null };

function modelUrl(name) {
  const base = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  if (!base) throw new Error("SUPABASE_URL not configured — cannot locate ml-models bucket");
  return `${base.replace(/\/$/, "")}/storage/v1/object/public/ml-models/${name}`;
}

/** Fetch a model file → Buffer. Dev override: repo ./models-cache/.
 * Weights larger than Supabase's plan-level 50MB object cap (CLIPSeg int8)
 * ship as 45MB `<name>.p1..pN` parts — fetched in sequence and joined. */
async function loadModelFile(name) {
  const local = pathResolve(ROOT, "models-cache", name);
  if (existsSync(local)) return readFileSync(local);
  const tmpDir = "/tmp/segment-models";
  const tmp = `${tmpDir}/${name}`;
  if (existsSync(tmp)) return readFileSync(tmp);
  let buf = await fetchModelObject(name);
  if (!buf) {
    // Fall back to parts: p1..pN until a miss (hard cap 8 guards runaway).
    const parts = [];
    for (let p = 1; p <= 8; p++) {
      const part = await fetchModelObject(`${name}.p${p}`);
      if (!part) break;
      parts.push(part);
    }
    if (!parts.length) {
      throw new Error(`Model ${name} unavailable. Run scripts/fetch-segment-models.mjs to provision the ml-models bucket.`);
    }
    buf = Buffer.concat(parts);
  }
  if (buf.length < 1024) throw new Error(`Model ${name} looks empty (${buf.length}B)`);
  try { mkdirSync(tmpDir, { recursive: true }); writeFileSync(tmp, buf); } catch { /* read-only /tmp — refetch next time */ }
  return buf;
}

/** GET one public ml-models object → Buffer | null (404/400 = missing). */
async function fetchModelObject(name) {
  const res = await fetch(modelUrl(name), { redirect: "follow" });
  if (!res.ok) {
    if (res.status === 404 || res.status === 400) return null; // 400 = Supabase "Object not found"
    throw new Error(`Model ${name} fetch failed (HTTP ${res.status})`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function getSession(key) {
  if (sessionCache.has(key)) return sessionCache.get(key);
  const buf = await loadModelFile(MODEL_FILES[key]);
  const sess = await ort.InferenceSession.create(buf);
  sessionCache.set(key, sess);
  return sess;
}

// ── Image helpers ─────────────────────────────────────────────────
const MAX_SIDE = 1024;

/** Load an image URL → { meta, base } where base = RGB raw ≤1024px. */
async function loadBaseImage(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Input image fetch failed (HTTP ${res.status})`);
  const input = Buffer.from(await res.arrayBuffer());
  const meta = await sharp(input, { failOn: "none" }).metadata();
  const base = await sharp(input, { failOn: "none" })
    .flatten({ background: "#000000" })
    .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { meta, base };
}

function nchw(raw, w, h, mean, std, dims) {
  const float = new Float32Array(3 * w * h);
  const plane = w * h;
  for (let i = 0; i < plane; i++) {
    float[i] = (raw[i * 3] - mean[0]) / std[0];
    float[plane + i] = (raw[i * 3 + 1] - mean[1]) / std[1];
    float[2 * plane + i] = (raw[i * 3 + 2] - mean[2]) / std[2];
  }
  return new ort.Tensor("float32", float, dims || [1, 3, h, w]);
}

/** Interleaved RGB raw bytes → HWC float tensor [h,w,3] in 0..255 scale. */
function hwcRaw(raw, w, h) {
  const float = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) float[i] = raw[i];
  return new ort.Tensor("float32", float, [h, w, 3]);
}

/** Resize a binary mask (1ch raw) to w×h and re-threshold.
 * toColourspace("b-w") is REQUIRED: sharp's resize of a 1-channel raw
 * input otherwise returns 3-channel data (probe-verified info.channels=3)
 * which silently scrambles every mask read as interleaved 1ch. */
async function resizeMask(maskU8, fromW, fromH, toW, toH) {
  if (fromW === toW && fromH === toH) return maskU8;
  const { data } = await sharp(maskU8, { raw: { width: fromW, height: fromH, channels: 1 } })
    .resize(toW, toH, { kernel: "cubic" })
    .toColourspace("b-w")
    .raw()
    .toBuffer({ resolveWithObject: true });
  const out = new Uint8Array(toW * toH);
  for (let i = 0; i < out.length; i++) out[i] = data[i] > 127 ? 255 : 0;
  return out;
}

// ── u2netp (remove_background) ────────────────────────────────────
async function u2netMask(base, w, h) {
  const S = 320;
  const { data: small } = await sharp(base.data, { raw: { width: w, height: h, channels: 3 } })
    .resize(S, S, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const input = nchw(small, S, S, [0.485 * 255, 0.456 * 255, 0.406 * 255], [0.229 * 255, 0.224 * 255, 0.225 * 255]);
  const sess = await getSession("u2netp");
  const feeds = { [sess.inputNames[0]]: input };
  const out = await sess.run(feeds);
  const logits = out[sess.outputNames[0]].data;
  let mi = Infinity, ma = -Infinity;
  for (let i = 0; i < logits.length; i++) {
    if (logits[i] < mi) mi = logits[i];
    if (logits[i] > ma) ma = logits[i];
  }
  const range = ma - mi || 1;
  const smallMask = new Uint8Array(S * S);
  for (let i = 0; i < smallMask.length; i++) {
    smallMask[i] = (logits[i] - mi) / range > 0.5 ? 255 : 0; // rembg postprocess
  }
  return resizeMask(smallMask, S, S, w, h);
}

// ── MobileSAM (segment_click) ─────────────────────────────────────
async function mobileSamMask(base, w, h, params) {
  // 1. 1024 letterbox: resize longest side, pad right/bottom with black.
  const scale = Math.min(MAX_SIDE / w, MAX_SIDE / h);
  const w2 = Math.max(1, Math.round(w * scale));
  const h2 = Math.max(1, Math.round(h * scale));
  const padded = await sharp(base.data, { raw: { width: w, height: h, channels: 3 } })
    .resize(w2, h2, { fit: "fill" })
    .extend({ right: MAX_SIDE - w2, bottom: MAX_SIDE - h2, background: { r: 0, g: 0, b: 0 } })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const encSess = await getSession("samEncoder");
  // Verified by probe: this export wants input_image as [1024,1024,3] HWC
  // in RAW 0..255 scale — normalization is folded into the graph. Mean/std
  // normalized data collapses the mask to noise (probe on a synthetic
  // subject: logits +12.98 subject vs −9.87 bg with raw input; ~8.8 vs ~8.8
  // indistinguishable with normalized input). Embeddings come back
  // correctly batched as [1,256,64,64].
  const image = hwcRaw(padded.data, MAX_SIDE, MAX_SIDE);
  const encOut = await encSess.run({ [encSess.inputNames[0]]: image });
  let embeddings = encOut[encSess.outputNames[0]];
  // Defensive: some exports also drop the batch dim on the output side.
  if (embeddings.dims.length === 3) {
    embeddings = new ort.Tensor("float32", embeddings.data, [1, embeddings.dims[0], embeddings.dims[1], embeddings.dims[2]]);
  }

  // 2. Prompts. Points arrive normalized 0..1 over the image → 1024 space.
  const points = Array.isArray(params.points) ? params.points : [];
  const box = params.box && typeof params.box === "object" ? params.box : null;
  const coords = [];
  const labels = [];
  for (const p of points) {
    coords.push([clamp01(p.x) * w2, clamp01(p.y) * h2]);
    labels.push(p.neg ? 0 : 1); // 1 = foreground click, 0 = background (Alt+click)
  }
  if (box) {
    coords.push([clamp01(box.x) * w2, clamp01(box.y) * h2]);
    coords.push([clamp01(box.x + (box.w || 0)) * w2, clamp01(box.y + (box.h || 0)) * h2]);
    labels.push(2, 3); // SAM box convention: top-left 2, bottom-right 3
  }
  if (!coords.length) throw new Error("segment_click needs points[] or box");
  // Verified decoder contract (models-cache, vietanhdev quant zip):
  //   inputs  [image_embeddings, point_coords, point_labels, mask_input,
  //           has_mask_input, orig_im_size]  — /has_mask/ MUST be tested
  //           before /mask_input/ ("has_mask_input" contains "mask_input").
  //   outputs [masks, iou_predictions, low_res_masks] — masks is [1,C,H,W]
  //           with C candidates; we threshold the highest-IoU one at >0
  //           (decoder emits sigmoid values: >0.5 ⟺ raw logit >0).
  const decSess = await getSession("samDecoder");
  const feeds = {};
  for (const name of decSess.inputNames) {
    if (/coord/i.test(name)) feeds[name] = new ort.Tensor("float32", Float32Array.from(coords.flat()), [1, coords.length, 2]);
    else if (/label/i.test(name)) feeds[name] = new ort.Tensor("float32", Float32Array.from(labels), [1, labels.length]);
    else if (/has_mask/i.test(name)) feeds[name] = new ort.Tensor("float32", new Float32Array([0]), [1]);
    else if (/mask_input/i.test(name)) feeds[name] = new ort.Tensor("float32", new Float32Array(256 * 256), [1, 1, 256, 256]);
    else if (/orig_im_size/i.test(name)) feeds[name] = new ort.Tensor("float32", Float32Array.from([h2, w2]), [2]);
    else if (/embedding/i.test(name)) feeds[name] = embeddings;
  }
  const decOut = await decSess.run(feeds);
  const masksKey = decSess.outputNames.find(n => /^masks$/i.test(n)) || decSess.outputNames[0];
  const maskTensor = decOut[masksKey];
  const iouKey = decSess.outputNames.find(n => /iou/i.test(n));
  const ious = iouKey ? decOut[iouKey].data : null;
  const numCand = maskTensor.dims[1] || 1;
  let best = 0;
  if (ious && numCand > 1) {
    for (let c = 1; c < numCand; c++) if (ious[c] > ious[best]) best = c;
  }
  const [bh, bw] = [maskTensor.dims[2], maskTensor.dims[3]];
  const logits = maskTensor.data;
  const plane = bw * bh;
  const off = best * plane;
  // This quantized decoder emits biased raw logits (probe: letterbox area
  // ≈1.5, subject ≈8.8 — a fixed >0 cut marks the whole frame foreground).
  // Min-max normalize then 0.5 adapts to the bias, rembg-style.
  let mi = Infinity, ma = -Infinity;
  for (let i = 0; i < plane; i++) {
    const v = logits[off + i];
    if (v < mi) mi = v;
    if (v > ma) ma = v;
  }
  const range = ma - mi || 1;
  const small = new Uint8Array(plane);
  for (let i = 0; i < plane; i++) small[i] = (logits[off + i] - mi) / range > 0.5 ? 255 : 0;
  // Decoder may answer at orig size (h2,w2) or low-res 256² — normalize to w×h.
  return resizeMask(small, bw, bh, w, h);
}

function clamp01(v) { return Math.min(1, Math.max(0, Number(v) || 0)); }

// ── CLIPSeg (segment_text) ────────────────────────────────────────
async function clipsegMask(base, w, h, prompt) {
  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    throw new Error("segment_text needs a text prompt");
  }
  const S = 352;
  const { data: smallImg } = await sharp(base.data, { raw: { width: w, height: h, channels: 3 } })
    .resize(S, S, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixelValues = nchw(smallImg, S, S,
    [0.48145466 * 255, 0.4578275 * 255, 0.40821073 * 255],
    [0.26862954 * 255, 0.26130258 * 255, 0.27577711 * 255]);

  if (!tokenizerCache.tok) {
    const [vocabBuf, mergesBuf] = await Promise.all([loadModelFile(MODEL_FILES.clipVocab), loadModelFile(MODEL_FILES.clipMerges)]);
    tokenizerCache.tok = new ClipTokenizer(JSON.parse(vocabBuf.toString("utf-8")), mergesBuf.toString("utf-8"));
  }
  const ids = tokenizerCache.tok.padTo77(tokenizerCache.tok.encode(prompt));
  const inputIds = new ort.Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, 77]);

  const sess = await getSession("clipseg");
  const feeds = {};
  for (const name of sess.inputNames) {
    if (/pixel/i.test(name)) feeds[name] = pixelValues;
    else if (/input_ids|token/i.test(name)) feeds[name] = inputIds;
    else if (/attention/i.test(name)) feeds[name] = new ort.Tensor("int64", BigInt64Array.from(new Array(77).fill(1n)), [1, 77]);
  }
  const out = await sess.run(feeds);
  const logitsTensor = out[sess.outputNames[0]];
  const logits = logitsTensor.data; // [1,1,352,352] or [1,352,352]
  const small = new Uint8Array(S * S);
  for (let i = 0; i < small.length; i++) {
    small[i] = 1 / (1 + Math.exp(-logits[i])) > 0.5 ? 255 : 0; // sigmoid + threshold
  }
  return resizeMask(small, S, S, w, h);
}

// ── Mask → cutout PNG / mask PNG / SVG path ───────────────────────
async function maskToPngs(base, w, h, mask) {
  const cutout = await sharp(base.data, { raw: { width: w, height: h, channels: 3 } })
    .joinChannel(Buffer.from(mask), { raw: { width: w, height: h, channels: 1 } })
    .png()
    .toBuffer();
  const maskPng = await sharp(Buffer.from(mask), { raw: { width: w, height: h, channels: 1 } })
    .png()
    .toBuffer();
  return { cutout, maskPng };
}

// Boundary trace: Moore-neighborhood on a downsampled grid, vertices
// recorded only at direction changes, then Douglas-Peucker simplifies.
// v1 outlines outer contours (holes inside a subject are not traced —
// documented pitfall; brush correction covers those cases).
const TRACE_MAX_SIDE = 480;

async function maskToSvgPath(mask, w, h) {
  const tw = Math.min(TRACE_MAX_SIDE, w);
  const th = Math.max(1, Math.round(h * (tw / w)));
  const { data } = await sharp(Buffer.from(mask), { raw: { width: w, height: h, channels: 1 } })
    .resize(tw, th, { kernel: "nearest" })
    .toColourspace("b-w") // keep 1-channel output — see resizeMask note
    .raw()
    .toBuffer({ resolveWithObject: true });
  const raw = new Uint8Array(tw * th);
  for (let i = 0; i < raw.length; i++) raw[i] = data[i] > 127 ? 1 : 0;
  // Despeckle: drop fg pixels with <2 fg 8-neighbors. u2netp/SAM masks are
  // clean (no-op); int8 CLIPSeg emits salt-noise that would otherwise
  // explode into thousands of 1-pixel contours.
  const grid = new Uint8Array(tw * th);
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      if (!raw[y * tw + x]) continue;
      let n = 0;
      for (let dy = -1; dy <= 1 && n < 2; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < tw && ny < th && raw[ny * tw + nx]) n++;
          if (n >= 2) break;
        }
      }
      grid[y * tw + x] = n >= 2 ? 1 : 0;
    }
  }

  const contours = traceContours(grid, tw, th);
  contours.sort((a, b) => b.length - a.length);
  const kept = contours.filter(c => c.length >= 3).slice(0, 8);
  if (!kept.length) return null;

  const subpaths = kept.map(pts => {
    const simp = rdp(pts, 1.2);
    const seg = `M ${simp.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" L ")} Z`;
    const norm = `M ${simp.map(p => `${(p.x / tw).toFixed(4)} ${(p.y / th).toFixed(4)}`).join(" L ")} Z`;
    return { seg, norm, points: simp.length };
  });
  const d = subpaths.map(s => s.seg).join(" ");
  const dNorm = subpaths.map(s => s.norm).join(" ");

  // bbox + area over the ORIGINAL grid resolution
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9, area = 0;
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      if (grid[y * tw + x]) {
        area++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return {
    d, dNorm, gridWidth: tw, gridHeight: th,
    bboxNorm: { x: minX / tw, y: minY / th, w: (maxX - minX + 1) / tw, h: (maxY - minY + 1) / th },
    areaRatio: area / (tw * th),
    subpaths: subpaths.length,
  };
}

const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]; // E…NE clockwise

function traceContours(grid, w, h) {
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
  const at = (x, y) => (inBounds(x, y) ? grid[y * w + x] : 0);
  // Only TRUE boundary pixels may seed a trace. Interior pixels must never
  // start one — they would trace the outer contour again as garbage
  // (probe-verified: a synthetic disc produced 1349 duplicate 3-pt contours
  // before this guard). A blob's full boundary ring gets marked visited by
  // its first trace, so later boundary pixels of the same blob are skipped.
  const isBoundary = (x, y) =>
    !at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || !at(x, y + 1);
  const visited = new Uint8Array(w * h);
  const contours = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!grid[y * w + x] || visited[y * w + x] || !isBoundary(x, y)) continue;
      // Moore-neighbor tracing from this contour's top-left pixel.
      const start = { x, y };
      const pts = [];
      let px = x, py = y;
      let dir = 0; // entered heading East (scan order)
      let guard = 0;
      const maxSteps = 4 * (w + h) * 2;
      let lastDx = null, lastDy = null;
      do {
        visited[py * w + px] = 1;
        let found = -1;
        for (let k = 1; k <= 8; k++) {
          const d = (dir + k + 7) % 8; // start from the neighbor after backtracking point
          const nx = px + DIRS[d][0];
          const ny = py + DIRS[d][1];
          if (at(nx, ny)) { found = d; break; }
        }
        if (found === -1) break; // isolated pixel
        const dx = DIRS[found][0], dy = DIRS[found][1];
        if (dx !== lastDx || dy !== lastDy) {
          pts.push({ x: px + 0.5, y: py + 0.5 });
          lastDx = dx; lastDy = dy;
        }
        px += dx; py += dy;
        dir = (found + 5) % 8; // backtrack reference for the next scan
        guard++;
      } while ((px !== start.x || py !== start.y) && guard < maxSteps);
      if (pts.length >= 3) contours.push(pts);
    }
  }
  return contours;
}

function rdp(points, epsilon) {
  if (points.length < 3) return points;
  let maxDist = 0, index = 0;
  const [first, last] = [points[0], points[points.length - 1]];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], first, last);
    if (d > maxDist) { maxDist = d; index = i; }
  }
  if (maxDist > epsilon) {
    const left = rdp(points.slice(0, index + 1), epsilon);
    const right = rdp(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

function perpendicularDistance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const norm = Math.hypot(dx, dy) || 1;
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / norm;
}

// ── Job orchestration ─────────────────────────────────────────────
function newAssetId() {
  return `asset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function runInference(job) {
  const { meta, base } = await loadBaseImage(job.input_url);
  const w = base.info.width, h = base.info.height;
  let mask;
  if (job.kind === "remove_background") mask = await u2netMask(base, w, h);
  else if (job.kind === "segment_click") mask = await mobileSamMask(base, w, h, job.params_json || {});
  else if (job.kind === "segment_text") mask = await clipsegMask(base, w, h, (job.params_json || {}).prompt);
  else throw new Error(`Unknown job kind: ${job.kind}`);

  const svgPath = await maskToSvgPath(mask, w, h);
  const { cutout, maskPng } = await maskToPngs(base, w, h, mask);

  const ws = job.workspace_id || "default";
  const srcTag = job.params_json?.sourceAssetId ? `src:${job.params_json.sourceAssetId}` : null;
  const baseTags = ["cutout"].concat(srcTag ? [srcTag] : []);

  const { uploadAsset, getSupabaseAdmin, getSupabase } = await sbService();
  const cutoutAssetId = newAssetId();
  const maskAssetId = newAssetId();
  const cutoutUrl = await uploadAsset(`seg_${cutoutAssetId}.png`, cutout, "image/png", ws);
  const maskUrl = await uploadAsset(`seg_${maskAssetId}.png`, maskPng, "image/png", ws);

  const sb = getSupabaseAdmin() || getSupabase();
  const srcName = (job.params_json?.sourceName || meta.format || "imagen").toString().slice(0, 60);
  if (sb) {
    const { error: e1 } = await sb.from("assets").upsert({
      id: cutoutAssetId, name: `${srcName} — calado`, filename: `seg_${cutoutAssetId}.png`,
      mime_type: "image/png", size_bytes: cutout.length, url: cutoutUrl,
      tags: baseTags, workspace_id: ws,
    });
    const { error: e2 } = await sb.from("assets").upsert({
      id: maskAssetId, name: `${srcName} — máscara`, filename: `seg_${maskAssetId}.png`,
      mime_type: "image/png", size_bytes: maskPng.length, url: maskUrl,
      tags: ["mask"].concat(srcTag ? [srcTag] : []), workspace_id: ws,
    });
    if (e1 || e2) console.error("[segment] asset row upsert:", e1?.message || e2?.message);
  }

  return {
    cutoutAssetId, cutoutUrl,
    maskAssetId, maskUrl,
    svgPath,
    imageWidth: w, imageHeight: h,
    origWidth: meta.width || w, origHeight: meta.height || h,
    engine: job.kind,
  };
}

/**
 * Claim a queued (or stale running) job and run it to done|error.
 * Safe under concurrency: the queued→running update is status-guarded.
 */
export async function processJobById(jobId) {
  const { getSupabaseAdmin, getSupabase } = await sbService();
  const sb = getSupabaseAdmin() || getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const now = new Date().toISOString();
  const { data: claimed } = await sb.from("segment_jobs")
    .update({ status: "running", updated_at: now })
    .eq("id", jobId).in("status", ["queued", "running"]) // running = stale claim from a dead invocation
    .select().maybeSingle();
  if (!claimed) {
    const { data: existing } = await sb.from("segment_jobs").select("id, status").eq("id", jobId).maybeSingle();
    return { skipped: true, status: existing?.status || "not_found" };
  }
  const startedAt = Date.now();
  try {
    const result = await runInference(claimed);
    const { error } = await sb.from("segment_jobs")
      .update({ status: "done", result_json: result, updated_at: new Date().toISOString() })
      .eq("id", jobId);
    if (error) throw new Error("Job done-write failed: " + error.message);
    console.log(`[segment] job ${jobId} (${claimed.kind}) done in ${Date.now() - startedAt}ms`);
    return { ok: true, result };
  } catch (e) {
    const message = String(e?.message || e).slice(0, 500);
    console.error(`[segment] job ${jobId} (${claimed.kind}) failed: ${message}`);
    await sb.from("segment_jobs")
      .update({ status: "error", error: message, updated_at: new Date().toISOString() })
      .eq("id", jobId);
    return { ok: false, error: message };
  }
}

/** Sweep queued jobs older than minAgeMs — the self-healing entry point. */
export async function sweepQueuedJobs(limit = 5, minAgeMs = 15_000) {
  const { getSupabaseAdmin, getSupabase } = await sbService();
  const sb = getSupabaseAdmin() || getSupabase();
  if (!sb) return [];
  const cutoff = new Date(Date.now() - minAgeMs).toISOString();
  const { data: jobs } = await sb.from("segment_jobs")
    .select("id")
    .eq("status", "queued")
    .lt("updated_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(limit);
  const processed = [];
  for (const j of jobs || []) {
    processed.push({ id: j.id, ...(await processJobById(j.id)) });
  }
  return processed;
}

/** Local smoke test: synthetic image through the engines — no DB involved.
 * Blue background + centered yellow circle; u2netp/SAM-click/CLIPSeg-text
 * should all find roughly the circle (~21% foreground). */
export async function selfTest(engines = ["u2netp", "sam", "clipseg"]) {
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#2a6be0"/><circle cx="200" cy="150" r="90" fill="#f2c14e"/></svg>`);
  const base = await sharp(svg).flatten().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = base.info.width, h = base.info.height;
  const out = {};
  if (engines.includes("u2netp")) {
    const t = Date.now();
    const mask = await u2netMask(base, w, h);
    const path = await maskToSvgPath(mask, w, h);
    out.u2netp = { ms: Date.now() - t, fgRatio: fgRatio(mask), subpaths: path?.subpaths, dLen: path?.d.length, d: path?.d?.slice(0, 80) };
  }
  if (engines.includes("sam")) {
    const t = Date.now();
    const mask = await mobileSamMask(base, w, h, { points: [{ x: 0.5, y: 0.5 }] });
    const path = await maskToSvgPath(mask, w, h);
    out.sam = { ms: Date.now() - t, fgRatio: fgRatio(mask), subpaths: path?.subpaths, dLen: path?.d.length, d: path?.d?.slice(0, 80) };
  }
  if (engines.includes("clipseg")) {
    const t = Date.now();
    const mask = await clipsegMask(base, w, h, "yellow circle");
    const path = await maskToSvgPath(mask, w, h);
    out.clipseg = { ms: Date.now() - t, fgRatio: fgRatio(mask), subpaths: path?.subpaths, dLen: path?.d.length, d: path?.d?.slice(0, 80) };
  }
  console.log(`[selfTest] ${JSON.stringify(out)}`);
  return out;
}

function fgRatio(mask) {
  let fg = 0;
  for (const v of mask) if (v) fg++;
  return +(fg / mask.length).toFixed(3);
}
