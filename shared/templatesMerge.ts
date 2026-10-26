/**
 * Templates Merge Core (REQ-060) — pure functions, zero I/O.
 * ──────────────────────────────────────────────────────────────
 * One implementation consumed by BOTH runtimes (repo convention: worker
 * bundles shared/*.ts via esbuild, api/src imports it directly):
 *
 *   - worker/runtime/functions/mcp.mjs  → templates_merge_plan / templates_merge
 *   - api/src/routes/templates.ts       → POST /api/templates/merge-plan|merge
 *
 * Contract (REQ-060 §2): frames append in `sources` order, target frames are
 * never touched, frame ids are remapped with a returned manifest, per-frame
 * animation travels with the frame (transitions remapped or dropped when the
 * referenced frame was not selected), styles/variables union first-wins,
 * optional content-hash dedup, optional videoTimeline concatenation.
 * Non-destructive: sources are read-only here — persistence and tenancy
 * checks belong to the callers.
 */

/** A merge source: a template id, optionally narrowed to specific frames. */
export interface MergeSourceRef {
  id: string;
  frameIds?: string[];
}

/** Shape of templates.data this core needs. Unknown keys ride along untouched. */
export interface MergeTemplateDataLike {
  frames?: any[];
  html?: string;
  css?: string;
  width?: number;
  height?: number;
  engine?: string;
  canvas?: any;
  styles?: Record<string, any> | any;
  variables?: Record<string, any> | any;
  videoTimeline?: any;
  [key: string]: any;
}

export interface MergeWarning {
  code:
    | "DIMENSION_MISMATCH"
    | "ENGINE_MISMATCH"
    | "SOURCE_MISSING"
    | "ORPHAN_TRANSITION_DROPPED"
    | "EMPTY_SOURCE"
    | "VIDEOTIMELINE_DROPPED"
    // No lo genera el core: lo agrega el llamador (REST/MCP) cuando el plan
    // supera el límite del body. Vive en el union para que plan.warnings sea
    // el único canal de avisos hacia UI e IA.
    | "PAYLOAD_TOO_LARGE";
  sourceId?: string;
  detail?: string;
}

export interface MergePlanSource {
  id: string;
  name: string;
  framesSelected: number;
  framesTotal: number;
  engine: string;
  width: number;
  height: number;
}

export interface MergeDuplicateGroup {
  hash: string;
  frames: Array<{ sourceId: string; frameId: string }>;
}

export interface MergePlan {
  target: { mode: "new" | "append"; name: string; currentFrames: number };
  perSource: MergePlanSource[];
  warnings: MergeWarning[];
  conflicts: { styles: string[]; variables: string[] };
  duplicates: MergeDuplicateGroup[];
  videoTimeline: { targetClips: number; perSourceClips: number[] } | null;
  estimatedBytes: number;
}

/** manifest[sourceId] lists every frame: `to` null when deduped away. */
export interface MergeManifestEntry {
  from: string;
  to: string | null;
  dedupOf?: string;
}

export interface MergeExecuteOptions {
  dedupe?: "off" | "skip";
  videoTimeline?: "keep-target" | "concat";
}

export interface MergeResult {
  data: MergeTemplateDataLike;
  manifest: Record<string, MergeManifestEntry[]>;
  perSourceFrames: Record<string, number>;
  frameCount: number;
  droppedTransitions: number;
  dedupedFrames: number;
  warnings: MergeWarning[];
}

// ── Normalization ───────────────────────────────────────────

/** Accepts "tpl_x" or { id, frameIds }; drops junk, dedupes source ids. */
export function normalizeMergeSources(input: unknown): MergeSourceRef[] {
  if (!Array.isArray(input)) throw new Error("sources must be an array");
  const out: MergeSourceRef[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw === "string" && raw.trim()) {
      if (!seen.has(raw)) { seen.add(raw); out.push({ id: raw }); }
      continue;
    }
    const obj = raw as { id?: unknown; templateId?: unknown; frameIds?: unknown } | null;
    const id = String(obj?.id ?? obj?.templateId ?? "").trim();
    if (!id) throw new Error("each source needs an id");
    if (seen.has(id)) continue;
    seen.add(id);
    const frameIds = Array.isArray(obj?.frameIds)
      ? obj.frameIds.map(f => String(f)).filter(Boolean)
      : undefined;
    out.push({ id, ...(frameIds && frameIds.length ? { frameIds } : {}) });
  }
  if (out.length < 2) throw new Error("merge needs at least 2 sources");
  return out;
}

/** Frames chosen by the source's optional frameIds (order preserved). */
export function collectSourceFrames(data: MergeTemplateDataLike | null | undefined, source: MergeSourceRef): { frames: any[]; total: number; missing: string[] } {
  const all = Array.isArray(data?.frames) ? data!.frames : [];
  if (!source.frameIds) return { frames: all.slice(), total: all.length, missing: [] };
  const byId = new Map(all.map(f => [String(f?.id), f]));
  const frames: any[] = [];
  const missing: string[] = [];
  for (const fid of source.frameIds) {
    const f = byId.get(fid);
    if (f) frames.push(f); else missing.push(fid);
  }
  return { frames, total: all.length, missing };
}

// ── Content hashing (dedup) ─────────────────────────────────

/** Deterministic stringify: object keys sorted, arrays in order. */
function sortedStringify(value: any): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(sortedStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${sortedStringify(value[k])}`).join(",")}}`;
}

/** Content hash of a frame: volatile fields (ids, names, timestamps) excluded. */
export function frameContentHash(frame: any): string {
  const { id, name, layerId, createdAt, updatedAt, ...rest } = frame || {};
  void id; void name; void layerId; void createdAt; void updatedAt;
  return sortedStringify(rest ?? {});
}

// ── Id remapping ────────────────────────────────────────────

let mergeCounter = 0;
function newFrameId(taken: Set<string>): string {
  for (;;) {
    mergeCounter = (mergeCounter + 1) % 1_000_000;
    const candidate = `f_mg${Date.now().toString(36)}${mergeCounter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
    if (!taken.has(candidate)) { taken.add(candidate); return candidate; }
  }
}

/**
 * Deep-clone frames, assign fresh ids, and remap every reference that points
 * at frame ids: transitions (frame.animation.transitions[].toFrameId) and the
 * common `frameId` fields found one level deep in metadata objects.
 */
function rekeyFrames(frames: any[], taken: Set<string>): { frames: any[]; map: Map<string, string> } {
  const map = new Map<string, string>();
  const cloned = frames.map(f => {
    const copy = JSON.parse(JSON.stringify(f ?? {}));
    const from = String(copy.id);
    const to = newFrameId(taken);
    copy.id = to;
    map.set(from, to);
    return copy;
  });
  let droppedTransitions = 0;
  for (const copy of cloned) {
    const anim = copy.animation;
    if (!anim || !Array.isArray(anim.transitions)) continue;
    anim.transitions = anim.transitions.filter((tr: any) => {
      const to = tr?.toFrameId != null ? map.get(String(tr.toFrameId)) : undefined;
      if (!to) { droppedTransitions += 1; return false; }
      tr.toFrameId = to;
      return true;
    });
  }
  (cloned as any).__droppedTransitions = droppedTransitions;
  return { frames: cloned, map };
}

// ── Document-level unions (first wins on conflict) ──────────

function unionMaps(base: any, incoming: any, conflicts: string[], label: string): any {
  if (incoming == null) return base;
  if (base == null) return incoming;
  if (typeof base !== "object" || typeof incoming !== "object") return base; // non-map payloads: first wins silently
  const out: Record<string, any> = { ...base };
  for (const [k, v] of Object.entries(incoming)) {
    if (!(k in out)) out[k] = v;
    else if (sortedStringify(out[k]) !== sortedStringify(v) && !conflicts.includes(`${label}.${k}`)) {
      conflicts.push(`${label}.${k}`);
    }
  }
  return out;
}

// ── Video timeline concatenation ────────────────────────────

const VT_TRACKS = ["textClips", "audioClips", "videoClips"] as const;

/** Effective visual duration of a file: longest frame animation or clip end. */
export function effectiveDurationSec(data: MergeTemplateDataLike | null | undefined): number {
  let max = 0;
  for (const f of Array.isArray(data?.frames) ? data!.frames : []) {
    const d = Number(f?.animation?.timeline?.durationSec);
    if (Number.isFinite(d) && d > max) max = d;
  }
  const vt = data?.videoTimeline;
  if (vt && typeof vt === "object") {
    for (const track of VT_TRACKS) {
      for (const clip of Array.isArray(vt[track]) ? vt[track] : []) {
        const start = Number(clip?.startSec) || 0;
        const dur = Number(clip?.durationSec) || 0;
        if (start + dur > max) max = start + dur;
      }
    }
  }
  return max;
}

/** Shift one source's videoTimeline clips by `offsetSec` onto the target doc. */
function concatVideoTimeline(target: any, sourceVt: any, offsetSec: number): { target: any; clipCount: number } {
  let count = 0;
  const out = target && typeof target === "object" ? { ...target } : {};
  for (const track of VT_TRACKS) {
    const clips = Array.isArray(sourceVt?.[track]) ? sourceVt[track] : [];
    if (!clips.length) continue;
    const shifted = clips.map((clip: any) => ({
      ...JSON.parse(JSON.stringify(clip ?? {})),
      startSec: (Number(clip?.startSec) || 0) + offsetSec,
    }));
    out[track] = [...(Array.isArray(out[track]) ? out[track] : []), ...shifted];
    count += shifted.length;
  }
  return { target: out, clipCount: count };
}

// ── Plan (dry-run, zero writes by construction) ─────────────

export interface MergePlanInput {
  sources: MergeSourceRef[];
  /** Per-source resolved row: { id, name, data }. Missing rows = SOURCE_MISSING. */
  resolved: Array<{ id: string; name: string; data: MergeTemplateDataLike | null }>;
  target?: { id?: string; name?: string; data?: MergeTemplateDataLike | null } | null;
}

export function planTemplateMerge(input: MergePlanInput): MergePlan {
  const warnings: MergeWarning[] = [];
  const conflicts: { styles: string[]; variables: string[] } = { styles: [], variables: [] };
  const perSource: MergePlanSource[] = [];
  const hashes = new Map<string, MergeDuplicateGroup>();
  let estimatedBytes = 0;
  let engineRef: string | null = null;
  let widthRef: number | null = null;
  let heightRef: number | null = null;

  const base = input.target?.data ?? null;
  if (input.target?.id) engineRef = base?.engine || null;

  for (const src of input.sources) {
    const row = input.resolved.find(r => r.id === src.id);
    if (!row || !row.data) {
      warnings.push({ code: "SOURCE_MISSING", sourceId: src.id, detail: "Template not found" });
      perSource.push({ id: src.id, name: row?.name || src.id, framesSelected: 0, framesTotal: 0, engine: "", width: 0, height: 0 });
      continue;
    }
    const { frames, total } = collectSourceFrames(row.data, src);
    if (!frames.length) warnings.push({ code: "EMPTY_SOURCE", sourceId: src.id, detail: "No frames selected" });
    const engine = String(row.data.engine || "");
    if (engineRef == null) engineRef = engine;
    else if (engine && engine !== engineRef) warnings.push({ code: "ENGINE_MISMATCH", sourceId: src.id, detail: `${engineRef} vs ${engine}` });
    const w = Number(row.data.width) || 0;
    const h = Number(row.data.height) || 0;
    if (widthRef == null && (w || h)) { widthRef = w; heightRef = h; }
    else if ((w || h) && (w !== widthRef || h !== heightRef)) {
      warnings.push({ code: "DIMENSION_MISMATCH", sourceId: src.id, detail: `${w}×${h} vs ${widthRef}×${heightRef}` });
    }
    for (const f of frames) {
      const hash = frameContentHash(f);
      const group = hashes.get(hash) || { hash, frames: [] };
      group.frames.push({ sourceId: src.id, frameId: String(f?.id) });
      hashes.set(hash, group);
      estimatedBytes += JSON.stringify(f ?? null).length;
    }
    perSource.push({ id: src.id, name: row.name, framesSelected: frames.length, framesTotal: total, engine, width: w, height: h });
  }

  const duplicates = [...hashes.values()].filter(g => g.frames.length > 1);
  const vtPerSource: number[] = [];
  for (const src of input.sources) {
    const row = input.resolved.find(r => r.id === src.id);
    const vt = row?.data?.videoTimeline;
    vtPerSource.push(vt && typeof vt === "object" ? VT_TRACKS.reduce((n, t) => n + (Array.isArray(vt[t]) ? vt[t].length : 0), 0) : 0);
  }
  const targetVtCount = base?.videoTimeline && typeof base.videoTimeline === "object"
    ? VT_TRACKS.reduce((n, t) => n + (Array.isArray(base.videoTimeline[t]) ? base.videoTimeline[t].length : 0), 0)
    : 0;
  const anyVt = targetVtCount > 0 || vtPerSource.some(n => n > 0);

  return {
    target: {
      mode: input.target?.id ? "append" : "new",
      name: input.target?.name || defaultMergeName(perSource),
      currentFrames: Array.isArray(base?.frames) ? base.frames.length : 0,
    },
    perSource,
    warnings,
    conflicts,
    duplicates,
    videoTimeline: anyVt ? { targetClips: targetVtCount, perSourceClips: vtPerSource } : null,
    estimatedBytes,
  };
}

function defaultMergeName(perSource: MergePlanSource[]): string {
  const names = perSource.map(s => s.name).filter(Boolean);
  const head = names.slice(0, 2).join(" + ");
  const tail = names.length > 2 ? ` (+${names.length - 2})` : "";
  return `Fusión: ${head}${tail}`;
}

// ── Execute (pure: returns the merged data; callers persist) ──

export interface MergeExecuteInput extends MergePlanInput {
  options?: MergeExecuteOptions;
}

export function executeTemplateMerge(input: MergeExecuteInput): MergeResult {
  const options = input.options || {};
  const dedupe = options.dedupe === "skip" ? "skip" : "off";
  const vtMode = options.videoTimeline === "concat" ? "concat" : "keep-target";
  const warnings: MergeWarning[] = [];
  const conflicts: { styles: string[]; variables: string[] } = { styles: [], variables: [] };
  const manifest: Record<string, MergeManifestEntry[]> = {};
  const perSourceFrames: Record<string, number> = {};

  const appending = Boolean(input.target?.id && input.target.data);
  const baseData: MergeTemplateDataLike = appending
    ? JSON.parse(JSON.stringify(input.target!.data))
    : { frames: [] };

  // New-file mode: canvas identity from the first resolvable source.
  if (!appending) {
    const first = input.resolved.find(r => r.data);
    if (first?.data) {
      baseData.engine = first.data.engine;
      baseData.width = first.data.width;
      baseData.height = first.data.height;
      baseData.canvas = first.data.canvas;
      // Document html/css only when every source shares the engine (§2.1.6).
      const engines = new Set(input.resolved.filter(r => r.data).map(r => String(r.data!.engine || "")));
      if (engines.size === 1) { baseData.html = first.data.html || ""; baseData.css = first.data.css || ""; }
    }
  }

  const taken = new Set<string>((Array.isArray(baseData.frames) ? baseData.frames : []).map(f => String(f?.id)));
  if (!Array.isArray(baseData.frames)) baseData.frames = [];
  const seenHashes = new Map<string, string>(); // hash → kept new frame id
  const targetStyleKeys = new Set(Object.keys(baseData.styles || {}));
  const targetVarKeys = new Set(Object.keys(baseData.variables || {}));
  let frameCount = baseData.frames.length;
  let dedupedFrames = 0;
  let droppedTransitions = 0;

  let vtOffset = appending ? effectiveDurationSec(input.target!.data) : 0;
  let vt = baseData.videoTimeline && typeof baseData.videoTimeline === "object" ? { ...baseData.videoTimeline } : {};

  for (const src of input.sources) {
    const row = input.resolved.find(r => r.id === src.id);
    if (!row || !row.data) continue;
    manifest[src.id] = [];
    const { frames } = collectSourceFrames(row.data, src);

    // Styles/variables union — first-wins, conflicts reported (§2.1.7).
    if (row.data.styles && typeof row.data.styles === "object") {
      const merged = unionMaps(
        Object.keys(baseData.styles || {}).length || targetStyleKeys.size ? baseData.styles : undefined,
        row.data.styles, conflicts.styles, "styles",
      );
      if (merged !== undefined) baseData.styles = merged;
    }
    if (row.data.variables && typeof row.data.variables === "object") {
      const merged = unionMaps(
        Object.keys(baseData.variables || {}).length || targetVarKeys.size ? baseData.variables : undefined,
        row.data.variables, conflicts.variables, "variables",
      );
      if (merged !== undefined) baseData.variables = merged;
    }

    // Video timeline (§3.2): default keep-target, opt-in concat.
    const sourceVt = row.data.videoTimeline;
    if (vtMode === "concat" && sourceVt && typeof sourceVt === "object") {
      const res = concatVideoTimeline(vt, sourceVt, vtOffset);
      vt = res.target;
      vtOffset += effectiveDurationSec(row.data);
    }

    const { frames: rekeyed, map } = rekeyFrames(frames, taken);
    droppedTransitions += (rekeyed as any).__droppedTransitions || 0;
    delete (rekeyed as any).__droppedTransitions;

    for (let i = 0; i < rekeyed.length; i++) {
      const original = frames[i];
      const from = String(original?.id);
      const copy = rekeyed[i];
      if (dedupe === "skip") {
        const hash = frameContentHash(original);
        const kept = seenHashes.get(hash);
        if (kept) {
          manifest[src.id].push({ from, to: null, dedupOf: kept });
          dedupedFrames += 1;
          continue;
        }
        seenHashes.set(hash, copy.id);
      }
      baseData.frames.push(copy);
      manifest[src.id].push({ from, to: copy.id });
      perSourceFrames[src.id] = (perSourceFrames[src.id] || 0) + 1;
      frameCount += 1;
    }

    if (vtMode === "keep-target" && sourceVt) {
      warnings.push({ code: "VIDEOTIMELINE_DROPPED", sourceId: src.id, detail: "videoTimeline=keep-target" });
    }
  }
  if (vtMode === "concat") baseData.videoTimeline = vt;

  return {
    data: baseData,
    manifest,
    perSourceFrames,
    frameCount,
    droppedTransitions,
    dedupedFrames,
    warnings,
  };
}
