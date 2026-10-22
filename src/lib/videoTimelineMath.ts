/**
 * videoTimelineMath — lógica PURA del timeline VID11 (REQ-VID11):
 * conversiones µs↔px, snap magnético (8px), trim con regla de oro CapCut
 * (source_dur = round(target_dur × speed)) y diff de árbol para el autosave.
 *
 * TODO el tiempo viaja en MICROSEGUNDOS enteros; el zoom (px/µs) es solo
 * visual y NUNCA toca datos. Estas funciones se espejan 1:1 con lo que hace
 * api/src/services/videoProjects.ts — cero drift cliente/servidor.
 */

export const US_PER_SECOND = 1_000_000;
/** Tolerancia del snap magnético en px de pantalla (REQ §3.3). */
export const SNAP_TOLERANCE_PX = 8;
/** Duración mínima de un segmento (el server valida ≥ 1 µs). */
export const MIN_SEGMENT_DUR_US = 1;
/** Duración default al soltar un material nuevo sin duración conocida. */
export const DEFAULT_DROP_DUR_US = 5_000_000;
/** Límites de velocidad — espejo de VIDEO_LIMITS del service (0.01–100). */
export const VIDEO_SPEED_MIN = 0.01;
export const VIDEO_SPEED_MAX = 100;

// ── Conversiones ────────────────────────────────────────────────────────────

export function usToPx(us: number, usPerPx: number): number {
  return us / usPerPx;
}

export function pxToUs(px: number, usPerPx: number): number {
  return px * usPerPx;
}

/** "m:ss.d" para etiquetas de bloque; "h:mm:ss.mmm" solo si supera la hora. */
export function formatTimecode(us: number, decimals: 1 | 3 = 1): string {
  const sign = us < 0 ? "-" : "";
  const abs = Math.abs(Math.round(us));
  const h = Math.floor(abs / 3_600_000_000);
  const m = Math.floor((abs % 3_600_000_000) / 60_000_000);
  const s = Math.floor((abs % 60_000_000) / US_PER_SECOND);
  const frac = abs % US_PER_SECOND;
  const core = h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
  if (decimals === 3) return `${sign}${core}.${String(frac).padStart(3, "0")}`;
  return `${sign}${core}.${String(Math.floor(frac / 100_000))}`;
}

// ── Snap magnético ──────────────────────────────────────────────────────────

/**
 * Snap del borde de un bloque al candidato más cercano dentro de la
 * tolerancia. `candidates` son µs (inicio/fin de otros clips, playhead,
 * marcas cada 1s). Devuelve el valor ajustado y dónde dibujar la guía
 * (null = sin snap, la guía se oculta).
 */
export function snapEdge(
  desiredUs: number,
  candidates: number[],
  toleranceUs: number,
): { value: number; guideUs: number | null } {
  let best: number | null = null;
  let bestDist = toleranceUs;
  for (const c of candidates) {
    const d = Math.abs(c - desiredUs);
    if (d <= bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best === null ? { value: Math.round(desiredUs), guideUs: null } : { value: best, guideUs: best };
}

/**
 * Snap de un MOVE: prueba el borde de inicio Y el de fin del bloque contra
 * los candidatos y gana el más cercano (así se apoya el tail de un clip con
 * el head del siguiente, como CapCut). `guideUs` = línea de alineación.
 */
export function snapMove(
  desiredStartUs: number,
  durUs: number,
  candidates: number[],
  toleranceUs: number,
  maxStartUs: number = Number.MAX_SAFE_INTEGER,
): { startUs: number; guideUs: number | null } {
  const tol = Math.max(1, Math.round(toleranceUs));
  const head = snapEdge(Math.max(0, desiredStartUs), candidates, tol);
  const tail = snapEdge(Math.max(0, desiredStartUs) + durUs, candidates, tol);
  // Empate → prefiere el head (el agarre suele estar más cerca del centro).
  if (head.guideUs !== null && tail.guideUs !== null) {
    const dHead = Math.abs(head.guideUs - desiredStartUs);
    const dTail = Math.abs(tail.guideUs - (desiredStartUs + durUs));
    if (dHead <= dTail) {
      return { startUs: Math.min(head.value, maxStartUs), guideUs: head.guideUs };
    }
    return { startUs: Math.min(tail.value - durUs, maxStartUs), guideUs: tail.guideUs };
  }
  if (head.guideUs !== null) return { startUs: Math.min(head.value, maxStartUs), guideUs: head.guideUs };
  if (tail.guideUs !== null) return { startUs: Math.min(tail.value - durUs, maxStartUs), guideUs: tail.guideUs };
  return { startUs: Math.max(0, Math.min(Math.round(desiredStartUs), maxStartUs)), guideUs: null };
}

/** Candidatos de snap: bordes de otros segments, playhead y marcas cada 1s. */
export function snapCandidates(opts: {
  excludeSegmentId: string | null;
  segments: Array<{ id: string; target_start_us: number; target_dur_us: number }>;
  playheadUs: number;
  windowEndUs: number;
}): number[] {
  const set = new Set<number>();
  for (const s of opts.segments) {
    if (s.id === opts.excludeSegmentId) continue;
    set.add(s.target_start_us);
    set.add(s.target_start_us + s.target_dur_us);
  }
  set.add(Math.max(0, Math.round(opts.playheadUs)));
  for (let s = 0; s <= opts.windowEndUs; s += US_PER_SECOND) set.add(s);
  return [...set];
}

// ── Trim con regla de oro (espejo exacto del service) ───────────────────────

/** target_dur = round(source_dur / speed), mínimo 1 µs (service). */
export function targetDurForSource(sourceDurUs: number, speed: number): number {
  return Math.max(1, Math.round(sourceDurUs / speed));
}

export interface SegmentTiming {
  target_start_us: number;
  target_dur_us: number;
  source_start_us: number | null;
  source_dur_us: number | null;
  speed: number;
}

/**
 * Trim por el borde IZQUIERDO: el usuario mueve el head `dtUs` (px→µs ya
 * aplicado, sin snap). Recalcula source respetando speed y re-deriva
 * target_dur EXACTAMENTE como trimVideoSegment (round(source/speed)) para
 * que el PATCH del autosave produzca el mismo estado que la preview.
 * El borde derecho se mantiene ±1 µs de redondeo (invisible).
 */
export function computeTrimLeft(
  seg: SegmentTiming,
  dtUs: number,
  materialDurUs: number | null,
): SegmentTiming {
  const speed = seg.speed > 0 ? seg.speed : 1;
  const srcStart0 = seg.source_start_us ?? 0;
  const srcDur0 = seg.source_dur_us ?? seg.target_dur_us;

  // Límites de dt: no salir del source, no cruzar el inicio, dur ≥ 1 µs.
  let dtMin = -srcStart0 / speed; // source_start' ≥ 0
  if (seg.target_start_us + dtMin < 0) dtMin = -seg.target_start_us;
  let dtMax = seg.target_dur_us - MIN_SEGMENT_DUR_US; // target_dur' ≥ 1
  if (materialDurUs !== null) {
    dtMax = Math.min(dtMax, (srcDur0 - MIN_SEGMENT_DUR_US) / speed);
  }
  const dt = Math.min(dtMax, Math.max(dtMin, dtUs));

  const sourceStart = Math.max(0, Math.round(srcStart0 + dt * speed));
  const sourceDur = Math.max(
    MIN_SEGMENT_DUR_US,
    Math.round(srcDur0 - dt * speed),
  );
  // Clamp CapCut: el trim NUNCA pasa el fin del material.
  const clampedSrcDur = materialDurUs !== null
    ? Math.max(MIN_SEGMENT_DUR_US, Math.min(sourceDur, materialDurUs - sourceStart))
    : sourceDur;
  const targetDur = targetDurForSource(clampedSrcDur, speed);
  return {
    target_start_us: Math.max(0, Math.round(seg.target_start_us + seg.target_dur_us - targetDur)),
    target_dur_us: targetDur,
    // Primer trim de texto/sticker sin source: se MATERIALIZA acá igual que
    // lo hará el server al aplicar el PATCH (sourceStart ?? 0), así el
    // autosave produce exactamente el estado que se previsualizó.
    source_start_us: sourceStart,
    source_dur_us: clampedSrcDur,
    speed,
  };
}

/**
 * Trim por el borde DERECHO: extiende/recorta hacia el fin. Clamp al fin del
 * material (como CapCut; el server además clampea con TRIM_PAST_SOURCE solo
 * si sourceStart lo pisa — la UI nunca lo deja llegar).
 */
export function computeTrimRight(
  seg: SegmentTiming,
  dtUs: number,
  materialDurUs: number | null,
): SegmentTiming {
  const speed = seg.speed > 0 ? seg.speed : 1;
  const srcStart0 = seg.source_start_us ?? 0;
  const srcDur0 = seg.source_dur_us ?? seg.target_dur_us;

  let dtMin = (MIN_SEGMENT_DUR_US - srcDur0) / speed; // dur ≥ 1 µs
  let dtMax = Number.MAX_SAFE_INTEGER;
  if (materialDurUs !== null) {
    dtMax = (materialDurUs - srcStart0 - srcDur0) / speed; // clamp al fin del source
  }
  const dt = Math.min(dtMax, Math.max(dtMin, dtUs));

  const sourceDur = Math.max(MIN_SEGMENT_DUR_US, Math.round(srcDur0 + dt * speed));
  const targetDur = targetDurForSource(sourceDur, speed);
  return {
    target_start_us: seg.target_start_us,
    target_dur_us: targetDur,
    source_start_us: sourceStart0Us(srcStart0, seg),
    source_dur_us: sourceDur,
    speed,
  };
}

/** Sin source declarado, el primer trim lo materializa desde 0 (server). */
function sourceStart0Us(srcStart0: number, seg: SegmentTiming): number {
  return seg.source_start_us === null && seg.source_dur_us === null ? 0 : srcStart0;
}

// ── Diff de árbol para el autosave (POST/PATCH/DELETE coalescedos) ──────────

export type VideoSaveOp =
  | { type: "material.add"; materialId: string; body: Record<string, unknown> }
  | { type: "material.patch"; materialId: string; body: Record<string, unknown> }
  | { type: "track.add"; trackId: string; body: Record<string, unknown> }
  | { type: "segment.add"; segmentId: string; body: Record<string, unknown> }
  | { type: "segment.patch"; segmentId: string; body: Record<string, unknown> }
  | { type: "segment.delete"; segmentId: string };

/** Estructura mínima que diffTreeOps consume (el doc normalizado del store
 *  la satisface: segments viven anidados en tracks). */
export interface DiffSegment {
  id: string;
  track_id: string;
  material_id: string;
  target_start_us: number;
  target_dur_us: number;
  source_start_us: number | null;
  source_dur_us: number | null;
  speed: number;
  clip: unknown;
  extra_refs: string[];
}
export interface DiffTrack {
  id: string;
  type: string;
  z_order: number;
  segments?: DiffSegment[];
}
export interface DiffMaterial {
  id: string;
  kind: string;
  payload: unknown;
  slot?: unknown;
}
export interface DiffTree {
  tracks: DiffTrack[];
  materials: DiffMaterial[];
}

/** Aplana los segments del árbol (viven anidados por track). */
function flatSegments(tree: DiffTree): DiffSegment[] {
  return tree.tracks.flatMap((t) => t.segments ?? []);
}

function clipChanged(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
}

/**
 * Diferencia mínima lastSaved→doc como ops REST ordenadas (materials antes
 * que segments; tracks antes que segments). Los segments comparan SOLO los
 * campos que el PATCH sabe aplicar: target_start_us (move),
 * source_start_us/source_dur_us (trim), speed (VID12 velocidad) y clip
 * (transform).
 * Nota: tracks/materials "borrados" por undo no tienen endpoint — se dejan
 * como huérfanos en el server (dif no los toca) y el reload los re-ve.
 */
export function diffTreeOps(
  before: DiffTree,
  after: DiffTree,
): VideoSaveOp[] {
  const ops: VideoSaveOp[] = [];
  const beforeSegments = flatSegments(before);
  const afterSegments = flatSegments(after);

  const matBefore = new Map(before.materials.map((m) => [m.id, m]));
  for (const m of after.materials) {
    const prev = matBefore.get(m.id);
    if (!prev) {
      ops.push({
        type: "material.add",
        materialId: m.id,
        body: { id: m.id, kind: m.kind, payload: m.payload, slot: (m as { slot?: unknown }).slot ?? undefined },
      });
      continue;
    }
    // VID12: payload editable (estilo de texto) — el autosave manda PATCH.
    if (JSON.stringify(prev.payload ?? null) !== JSON.stringify(m.payload ?? null)) {
      ops.push({ type: "material.patch", materialId: m.id, body: { payload: m.payload } });
    }
  }

  const trackBefore = new Map(before.tracks.map((t) => [t.id, t]));
  for (const t of after.tracks) {
    if (!trackBefore.has(t.id)) {
      ops.push({ type: "track.add", trackId: t.id, body: { id: t.id, type: t.type, zOrder: t.z_order } });
    }
  }

  const segBefore = new Map(beforeSegments.map((s) => [s.id, s]));
  const segAfter = new Map(afterSegments.map((s) => [s.id, s]));
  for (const s of afterSegments) {
    const prev = segBefore.get(s.id);
    if (!prev) {
      ops.push({
        type: "segment.add",
        segmentId: s.id,
        body: {
          id: s.id,
          trackId: s.track_id,
          materialId: s.material_id,
          targetStartUs: s.target_start_us,
          targetDurUs: s.target_dur_us,
          ...(s.source_start_us !== null && s.source_start_us !== undefined ? { sourceStartUs: s.source_start_us } : {}),
          ...(s.source_dur_us !== null && s.source_dur_us !== undefined ? { sourceDurUs: s.source_dur_us } : {}),
          ...(typeof s.speed === "number" && s.speed !== 1 ? { speed: s.speed } : {}),
          ...(s.clip !== null && s.clip !== undefined ? { clip: s.clip } : {}),
          ...(Array.isArray(s.extra_refs) && s.extra_refs.length > 0 ? { extraRefs: s.extra_refs } : {}),
        },
      });
      continue;
    }
    const body: Record<string, unknown> = {};
    if (prev.target_start_us !== s.target_start_us) body.targetStartUs = s.target_start_us;
    if (prev.source_start_us !== s.source_start_us || prev.source_dur_us !== s.source_dur_us) {
      // Trim SIEMPRE manda ambas (el server re-deriva target_dur con speed).
      body.sourceStartUs = s.source_start_us ?? 0;
      body.sourceDurUs = s.source_dur_us ?? s.target_dur_us;
    }
    // VID12: velocidad — sin esto el autosave ve 0 ops y adopta el doc como
    // guardado (badge "Guardado") sin PATCH: el cambio se pierde al recargar.
    if (prev.speed !== s.speed) body.speed = s.speed;
    if (clipChanged(prev.clip, s.clip)) body.clip = s.clip ?? null;
    if (Object.keys(body).length > 0) ops.push({ type: "segment.patch", segmentId: s.id, body });
  }
  for (const s of beforeSegments) {
    if (!segAfter.has(s.id)) ops.push({ type: "segment.delete", segmentId: s.id });
  }

  return ops;
}
