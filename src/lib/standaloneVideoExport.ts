/**
 * standaloneVideoExport — puente del proyecto CapCut standalone al encoder
 * probado del Video Mode. Conserva una sola ruta de codec/audio/canvas y
 * traduce las filas `musa_video_*` a sus entradas declarativas.
 *
 * El puente nunca descarta un nodo silenciosamente: antes de exportar arma un
 * plan con un informe de fidelidad. Lo que el renderer conoce se exporta; lo
 * que todavía no tiene renderer bloquea la exportación con un error concreto.
 */
import { defaultAnimation } from "../../shared/animationSchema.ts";
import { TEXT_ANIMS, type TextAnimId } from "../../shared/videoEffectsCatalog.ts";
import {
  downloadVideoBlob,
  exportReelVideo,
  type ReelAudioClipInput,
  type ReelExportMediaClip,
  type ReelExportOverlay,
  type ReelExportResult,
  type ReelExportSceneClip,
} from "./videoExport";
import { effectsForSegment, lutFilterCss, overlayStyle } from "./videoEffects";
import type { ReelTextClip, ReelTextTransform } from "./videoTimelineDoc";
import type { VideoMaterial, VideoProjectDoc, VideoSegment } from "./videoProjectStore";
import { contentEndUs, materialMap } from "../components/video/videoDocOps";
import { motionPropsFromPayload } from "./motionKeyframes";
import { ensureMotionFonts, motionFontAssetsFromPayloads } from "./motionFonts";
import { outputDurationSec, totalCutDuration, visibleSpans, type TimeCut } from "../../shared/fillerWords";

const US = 1_000_000;
const TEXT_ANIM_IDS = new Set<TextAnimId>(TEXT_ANIMS.map(({ id }) => id));
const SAFE_CSS_VALUE = /^[a-zA-Z0-9#(),.%\s_\-/'"]*$/;
const SAFE_FONT = /^[a-zA-Z0-9,\s_\-'"]{1,180}$/;

type MediaPayload = {
  url?: unknown;
  durationUs?: unknown;
  name?: unknown;
  filter?: unknown;
  volume?: unknown;
  fadeInSec?: unknown;
  fadeOutSec?: unknown;
  loopWhenShort?: unknown;
};
type TextPayload = { text?: unknown; style?: unknown; ranges?: unknown; props?: unknown; keyframes?: unknown; motionCanvas?: unknown };
type TextStyle = Record<string, unknown>;

export interface StandaloneExportFidelityIssue {
  severity: "warning" | "error";
  code: string;
  message: string;
  segmentId?: string;
  materialId?: string;
}

export interface StandaloneExportFidelity {
  warnings: StandaloneExportFidelityIssue[];
  errors: StandaloneExportFidelityIssue[];
}

export interface StandaloneAudioDescriptor {
  url: string;
  startSec: number;
  durationSec: number;
  volume: number;
  fadeInSec: number;
  fadeOutSec: number;
  offsetSec: number;
  loopWhenShort: boolean;
  playbackRate: number;
}

export interface StandaloneExportPlan {
  durationSec: number;
  media: ReelExportMediaClip[];
  texts: ReelTextClip[];
  overlays: ReelExportOverlay[];
  /** REQ-052: escenas 3D POR REFERENCIA (el spec se resuelve al renderizar). */
  scenes: ReelExportSceneClip[];
  audio: StandaloneAudioDescriptor[];
  fidelity: StandaloneExportFidelity;
}

export interface StandaloneExportResult extends ReelExportResult {
  fidelity: StandaloneExportFidelity;
}

/** A typed failure lets the UI show unsupported generated nodes next to the
 * Export action instead of downloading a file that omitted them. */
export class StandaloneExportFidelityError extends Error {
  readonly fidelity: StandaloneExportFidelity;

  constructor(fidelity: StandaloneExportFidelity) {
    super(`No se puede exportar todavía: ${fidelity.errors.map((issue) => issue.message).join(" ")}`);
    this.name = "StandaloneExportFidelityError";
    this.fidelity = fidelity;
  }
}

function publicUrl(payload: MediaPayload): string | null {
  return typeof payload.url === "string" && /^(https?:\/\/|\/)/.test(payload.url) ? payload.url : null;
}

function seconds(us: number | null | undefined, fallback: number): number {
  return typeof us === "number" && Number.isFinite(us) && us > 0 ? us / US : fallback;
}

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

function browserPlaybackRate(raw: unknown, fidelity: StandaloneExportFidelity, segment: VideoSegment, material: VideoMaterial): number {
  const requested = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 1;
  const resolved = bounded(requested, 1, 0.0625, 16);
  if (resolved !== requested) {
    fidelity.warnings.push({
      severity: "warning",
      code: "SPEED_CLAMPED_FOR_BROWSER",
      message: `La velocidad ${requested}× del clip se exportará a ${resolved}×, que es el rango reproducible por el navegador.`,
      segmentId: segment.id,
      materialId: material.id,
    });
  }
  return resolved;
}

function safeCss(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const value = raw.trim();
  return value && value.length <= 120 && SAFE_CSS_VALUE.test(value) && !/url\(/i.test(value) ? value : "";
}

function safeFont(raw: unknown): string {
  return typeof raw === "string" && SAFE_FONT.test(raw) ? raw : "system-ui, sans-serif";
}

function textAnimation(raw: unknown): TextAnimId {
  return typeof raw === "string" && TEXT_ANIM_IDS.has(raw as TextAnimId) ? raw as TextAnimId : "fade";
}

function asTextStyle(raw: unknown): TextStyle {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as TextStyle : {};
}

/** The persisted material payload is the single source for generated motion.
 * Keep only the keys consumed by the pure sampler so preview/export never
 * receive arbitrary JSON as executable styling. */
function materialMotion(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!payload.props && !payload.keyframes) return undefined;
  return {
    ...(payload.props !== undefined ? { props: payload.props } : {}),
    ...(payload.keyframes !== undefined ? { keyframes: payload.keyframes } : {}),
    ...(payload.motionCanvas !== undefined ? { motionCanvas: payload.motionCanvas } : {}),
  };
}

function motionTextStyle(payload: Record<string, unknown>): TextStyle {
  const props = motionPropsFromPayload(payload);
  const style: TextStyle = {};
  if (typeof props.color === "string") style.color = props.color;
  if (typeof props.background === "string") style.background = props.background;
  else if (typeof props.backgroundColor === "string") style.background = props.backgroundColor;
  if (typeof props.fontFamily === "string") style.fontFamily = props.fontFamily;
  if (typeof props.fontSize === "number") style.fontSize = props.fontSize;
  if (typeof props.fontWeight === "number") style.fontWeight = props.fontWeight;
  return style;
}

function textTransform(seg: VideoSegment): ReelTextTransform | null {
  if (!seg.clip || typeof seg.clip !== "object") return null;
  const clip = seg.clip;
  const flip = clip.flip && typeof clip.flip === "object" ? clip.flip as Record<string, unknown> : null;
  return {
    scale: bounded(clip.scale, 1, 0.01, 100),
    rotation: bounded(clip.rotation, 0, -3600, 3600),
    alpha: bounded(clip.alpha, 1, 0, 1),
    flip: flip ? { x: flip.x === true, y: flip.y === true } : null,
  };
}

function textPosition(seg: VideoSegment, style: TextStyle): { xPct: number; yPct: number } {
  const explicitX = typeof style.xPct === "number" && Number.isFinite(style.xPct) ? style.xPct : null;
  const explicitY = typeof style.yPct === "number" && Number.isFinite(style.yPct) ? style.yPct : null;
  const clip = seg.clip && typeof seg.clip === "object" ? seg.clip : null;
  const x = clip ? 50 + bounded(clip.x, 0, -1, 1) * 50 : 50;
  // Preserve the legacy standalone caption baseline when the segment has no
  // transform; a generated MotionSpec can set clip.y or style.yPct explicitly.
  const y = clip ? 50 + bounded(clip.y, 0, -1, 1) * 50 : 78;
  return {
    xPct: bounded(explicitX, x, 0, 100),
    yPct: bounded(explicitY, y, 0, 100),
  };
}

function textSizePct(style: TextStyle): number {
  const raw = style.fontSize;
  // The project contract uses a canvas fraction (0.04..0.28). Accept a
  // percentage too so hand-authored MotionSpec payloads stay ergonomic.
  const pct = typeof raw === "number" && Number.isFinite(raw)
    ? (raw > 1 ? raw : raw * 100)
    : 6;
  return bounded(pct, 6, 4, 28);
}

function textClip(
  seg: VideoSegment,
  material: VideoMaterial,
  id = seg.id,
  textOverride?: string,
  styleOverride?: unknown,
  renderOrder?: number,
): ReelTextClip | null {
  if (material.kind !== "text" && textOverride === undefined) return null;
  const payload = material.payload as TextPayload;
  const text = textOverride ?? payload.text;
  if (typeof text !== "string" || !text.trim()) return null;
  const style = {
    ...motionTextStyle(payload as Record<string, unknown>),
    ...asTextStyle(styleOverride ?? payload.style),
  };
  const position = textPosition(seg, style);
  return {
    id,
    text,
    startSec: seg.target_start_us / US,
    durationSec: seg.target_dur_us / US,
    xPct: position.xPct,
    yPct: position.yPct,
    sizePct: textSizePct(style),
    color: safeCss(style.color) || "#ffffff",
    font: safeFont(style.fontFamily),
    weight: Math.round(bounded(style.fontWeight, 700, 100, 900)),
    bg: safeCss(style.background),
    anim: textAnimation(style.anim ?? style.animation),
    transform: textTransform(seg),
    ...(material.kind === "text" && materialMotion(payload as Record<string, unknown>)
      ? { motion: materialMotion(payload as Record<string, unknown>) }
      : {}),
    ...(typeof renderOrder === "number" ? { renderOrder } : {}),
  };
}

function mediaClip(
  seg: VideoSegment,
  material: VideoMaterial,
  effectFilters: string[],
  fidelity: StandaloneExportFidelity,
  renderOrder?: number,
): ReelExportMediaClip | null {
  if (material.kind !== "video" && material.kind !== "image") return null;
  const payload = material.payload as MediaPayload;
  const url = publicUrl(payload);
  if (!url) return null;
  const playbackRate = material.kind === "video"
    ? browserPlaybackRate(seg.speed, fidelity, seg, material)
    : 1;
  return {
    kind: material.kind,
    url,
    startSec: seg.target_start_us / US,
    durationSec: seg.target_dur_us / US,
    trimInSec: (seg.source_start_us ?? 0) / US,
    sourceDurationSec: seconds(payload.durationUs as number | undefined, 0),
    volume: bounded(payload.volume, 1, 0, 1.5),
    fadeInSec: bounded(payload.fadeInSec, 0.1, 0, 30),
    fadeOutSec: bounded(payload.fadeOutSec, 0.25, 0, 30),
    playbackRate,
    filter: [safeCss(payload.filter), ...effectFilters].filter(Boolean).join(" "),
    transform: seg.clip as ReelExportMediaClip["transform"],
    ...(materialMotion(payload as Record<string, unknown>) ? { motion: materialMotion(payload as Record<string, unknown>) } : {}),
    ...(typeof renderOrder === "number" ? { renderOrder } : {}),
  };
}

function audioDescriptor(seg: VideoSegment, material: VideoMaterial, fidelity: StandaloneExportFidelity): StandaloneAudioDescriptor | null {
  if (material.kind !== "audio") return null;
  const payload = material.payload as MediaPayload;
  const url = publicUrl(payload);
  if (!url) return null;
  return {
    url,
    startSec: seg.target_start_us / US,
    durationSec: seg.target_dur_us / US,
    volume: bounded(payload.volume, 1, 0, 1.5),
    fadeInSec: bounded(payload.fadeInSec, 0, 0, 30),
    fadeOutSec: bounded(payload.fadeOutSec, 0, 0, 30),
    offsetSec: (seg.source_start_us ?? 0) / US,
    loopWhenShort: payload.loopWhenShort === true,
    playbackRate: browserPlaybackRate(seg.speed, fidelity, seg, material),
  };
}

function pushIssue(
  fidelity: StandaloneExportFidelity,
  severity: StandaloneExportFidelityIssue["severity"],
  code: string,
  message: string,
  seg: VideoSegment,
  materialId?: string,
) {
  fidelity[severity === "error" ? "errors" : "warnings"].push({ severity, code, message, segmentId: seg.id, materialId });
}

function canvasBlend(raw: unknown): GlobalCompositeOperation {
  const blend = typeof raw === "string" ? raw : "normal";
  return blend === "normal" ? "source-over" : blend as GlobalCompositeOperation;
}

/**
 * REQ-063 (fase 4): aplica los cortes de muletillas al plan. Cada clip se
 * parte en sus tramos visibles con la MISMA función (`visibleSpans`) que la
 * preview usa sobre el playhead — paridad por construcción. El medio
 * conserva su trim de origen avanzado (× playbackRate), el audio se agenda
 * solo en los tramos que sobreviven (el empalme sale solo) y el texto se
 * re-muestra en cada tramo visible.
 */
function applyCutsToPlan(plan: StandaloneExportPlan, cuts: TimeCut[]): StandaloneExportPlan {
  if (cuts.length === 0) return plan;
  const spansOf = (startSec: number, durationSec: number) => visibleSpans(startSec, startSec + durationSec, cuts);
  const media = plan.media.flatMap((clip) => spansOf(clip.startSec, clip.durationSec).map((span) => ({
    ...clip,
    startSec: span.outputStartSec,
    durationSec: span.durSec,
    trimInSec: (clip.trimInSec ?? 0) + (span.sourceStartSec - clip.startSec) * (clip.playbackRate || 1),
  })));
  const audio = plan.audio.flatMap((descriptor) => spansOf(descriptor.startSec, descriptor.durationSec).map((span) => ({
    ...descriptor,
    startSec: span.outputStartSec,
    durationSec: span.durSec,
    offsetSec: descriptor.offsetSec + (span.sourceStartSec - descriptor.startSec) * (descriptor.playbackRate || 1),
  })));
  const texts = plan.texts.flatMap((clip) => spansOf(clip.startSec, clip.durationSec).map((span) => ({
    ...clip,
    startSec: span.outputStartSec,
    durationSec: span.durSec,
  })));
  const overlays = plan.overlays.flatMap((overlay) => spansOf(overlay.startSec, overlay.durationSec).map((span) => ({
    ...overlay,
    startSec: span.outputStartSec,
    durationSec: span.durSec,
  })));
  const scenes = plan.scenes.flatMap((scene) => spansOf(scene.startSec, scene.durationSec).map((span) => ({
    ...scene,
    startSec: span.outputStartSec,
    durationSec: span.durSec,
  })));
  plan.fidelity.warnings.push({
    severity: "warning",
    code: "CUTS_APPLIED",
    message: `Cortes activos: ${cuts.length} región(es) que quitan ${totalCutDuration(cuts).toFixed(1)}s — el audio se empalma en cada corte (en rutas sin audio como GIF, solo aplica el video).`,
  });
  return {
    ...plan,
    durationSec: outputDurationSec(plan.durationSec, cuts),
    media,
    audio,
    texts,
    overlays,
    scenes,
  };
}

/**
 * Build the deterministic export plan without using DOM, network or encoders.
 * It is intentionally exported so the arnés and QA can inspect exact fidelity
 * before a person spends time on a browser export.
 */
export function buildStandaloneExportPlan(doc: VideoProjectDoc, cuts: TimeCut[] = []): StandaloneExportPlan {
  const fidelity: StandaloneExportFidelity = { warnings: [], errors: [] };
  const materials = materialMap(doc);
  const media: ReelExportMediaClip[] = [];
  const texts: ReelTextClip[] = [];
  const overlays: ReelExportOverlay[] = [];
  const scenes: ReelExportSceneClip[] = [];
  const audio: StandaloneAudioDescriptor[] = [];
  let nextVisualOrder = 0;

  for (const track of [...doc.tracks].sort((a, b) => a.z_order - b.z_order)) {
    for (const seg of track.segments) {
      const material = materials.get(seg.material_id);
      if (!material) {
        pushIssue(fidelity, "error", "MATERIAL_MISSING", "El segmento apunta a un material que ya no existe.", seg, seg.material_id);
        continue;
      }
      const renderOrder = material.kind === "audio" ? undefined : nextVisualOrder++;

      const effects = effectsForSegment(doc, seg);
      const effectFilters = effects
        .filter(({ effect }) => effect.manifest.name === "fx-lut")
        .map(({ effect }) => lutFilterCss(effect.params))
        .filter((value): value is string => Boolean(value));

      if (material.kind === "video" || material.kind === "image") {
        const clip = mediaClip(seg, material, effectFilters, fidelity, renderOrder);
        if (clip) media.push(clip);
        else pushIssue(fidelity, "error", "MEDIA_URL_INVALID", "El clip de media no tiene una URL pública exportable.", seg, material.id);
      } else if (material.kind === "text") {
        const clip = textClip(seg, material, seg.id, undefined, undefined, renderOrder);
        if (clip) texts.push(clip);
        else pushIssue(fidelity, "error", "TEXT_INVALID", "El material de texto no tiene contenido exportable.", seg, material.id);
        const ranges = (material.payload as TextPayload).ranges;
        if (Array.isArray(ranges) && ranges.length > 0) {
          pushIssue(fidelity, "warning", "TEXT_RANGES_FLATTENED", "El export actual preserva el texto y su estilo principal; los rangos de estilo interno se exportan como texto plano.", seg, material.id);
        }
      } else if (material.kind === "audio") {
        const descriptor = audioDescriptor(seg, material, fidelity);
        if (descriptor) audio.push(descriptor);
        else pushIssue(fidelity, "error", "AUDIO_URL_INVALID", "El clip de audio no tiene una URL pública exportable.", seg, material.id);
      } else if (material.kind === "scene") {
        // REQ-052: la escena viaja por referencia; el plan sigue siendo puro
        // (sin DOM ni red). El renderer resuelve el spec y falla explícito si
        // no carga — nunca se exporta una escena incompleta de silencio.
        const sceneSpecId = (material.payload as { sceneSpecId?: unknown }).sceneSpecId;
        if (typeof sceneSpecId !== "string" || !/^scenespec_[A-Za-z0-9_-]{6,64}$/.test(sceneSpecId)) {
          pushIssue(fidelity, "error", "SCENE_SPEC_REF_INVALID", "El material de escena no porta un sceneSpecId válido.", seg, material.id);
        } else {
          const variableValues = (material.payload as { variableValues?: unknown }).variableValues;
          scenes.push({
            projectId: doc.project.id,
            sceneSpecId,
            startSec: seg.target_start_us / US,
            durationSec: seg.target_dur_us / US,
            ...(variableValues && typeof variableValues === "object" && !Array.isArray(variableValues)
              ? { variableValues: variableValues as Record<string, unknown> }
              : {}),
            ...(typeof renderOrder === "number" ? { renderOrder } : {}),
          });
        }
      } else {
        pushIssue(fidelity, "error", "MATERIAL_UNSUPPORTED", `El material «${material.kind}» todavía no tiene renderer standalone.`, seg, material.id);
      }

      let effectIndex = 0;
      for (const { materialId, effect } of effects) {
        const effectRenderOrder = renderOrder === undefined ? undefined : renderOrder + (++effectIndex / 100);
        switch (effect.manifest.name) {
          case "fx-lut": {
            if (material.kind !== "video" && material.kind !== "image") {
              pushIssue(fidelity, "error", "LUT_TARGET_UNSUPPORTED", "El LUT requiere un clip de video o imagen como destino.", seg, materialId);
            }
            break;
          }
          case "fx-overlay": {
            if (material.kind !== "video" && material.kind !== "image" && material.kind !== "text") {
              pushIssue(fidelity, "error", "OVERLAY_TARGET_UNSUPPORTED", "El overlay requiere un clip visual como destino.", seg, materialId);
              break;
            }
            const style = overlayStyle(effect.params);
            if (typeof style.background !== "string") {
              pushIssue(fidelity, "error", "OVERLAY_INVALID", "El overlay no tiene un color exportable.", seg, materialId);
              break;
            }
            overlays.push({
              startSec: seg.target_start_us / US,
              durationSec: seg.target_dur_us / US,
              color: style.background,
              blend: canvasBlend(style.mixBlendMode),
              ...(typeof effectRenderOrder === "number" ? { renderOrder: effectRenderOrder } : {}),
            });
            break;
          }
          case "fx-text-anim": {
            const params = effect.params;
            const text = typeof params.text === "string" && params.text.trim() ? params.text : "Texto";
            const style = asTextStyle(params.style);
            const clip = textClip(seg, material, `fx:${materialId}`, text, {
              ...style,
              anim: params.anim,
              // Matches the preview's bottom caption baseline unless the
              // MotionSpec deliberately specifies another location.
              yPct: style.yPct ?? 88,
            }, effectRenderOrder);
            if (clip) texts.push(clip);
            break;
          }
          case "fx-sticker-kf":
            pushIssue(fidelity, "error", "STICKER_KEYFRAMES_UNSUPPORTED", "El sticker con keyframes se ve en preview, pero todavía no tiene renderer Canvas equivalente.", seg, materialId);
            break;
          default:
            pushIssue(fidelity, "error", "EFFECT_UNSUPPORTED", `El efecto «${effect.manifest.name}» no tiene renderer standalone.`, seg, materialId);
        }
      }

      for (const refId of seg.extra_refs) {
        const companion = materials.get(refId);
        if (companion?.kind === "transition") {
          pushIssue(fidelity, "error", "TRANSITION_UNSUPPORTED", "La transición standalone necesita un renderer dedicado antes de exportarse.", seg, refId);
        }
      }
    }
  }

  return applyCutsToPlan({
    durationSec: Math.max(0.1, contentEndUs(doc) / US),
    media,
    texts,
    overlays,
    scenes,
    audio,
    fidelity,
  }, cuts);
}

export function assertStandaloneExportable(fidelity: StandaloneExportFidelity): void {
  if (fidelity.errors.length > 0) throw new StandaloneExportFidelityError(fidelity);
}

async function loadAudio(descriptor: StandaloneAudioDescriptor): Promise<ReelAudioClipInput> {
  const res = await fetch(descriptor.url);
  if (!res.ok) throw new Error(`No se pudo leer el audio ${descriptor.url}.`);
  return {
    data: await res.arrayBuffer(),
    startSec: descriptor.startSec,
    durationSec: descriptor.durationSec,
    volume: descriptor.volume,
    fadeInSec: descriptor.fadeInSec,
    fadeOutSec: descriptor.fadeOutSec,
    offsetSec: descriptor.offsetSec,
    loopWhenShort: descriptor.loopWhenShort,
    playbackRate: descriptor.playbackRate,
  };
}

export interface StandaloneExportOptions {
  format?: "webm" | "mp4";
  scale?: number;
  /** REQ-063: cortes de muletillas (segundos de timeline ORIGINAL). La
   *  preview usa el mismo par de funciones → paridad por construcción. */
  cuts?: TimeCut[];
  onProgress?: (fraction: number) => void;
}

/** Exporta el mismo documento que el editor muestra. Los medios cargan desde
 * Storage/URLs públicas; el informe de fidelidad evita exportaciones que
 * aparenten conservar una animación o un efecto que el Canvas todavía omite. */
export async function exportStandaloneVideo(
  doc: VideoProjectDoc,
  options: StandaloneExportOptions = {},
): Promise<StandaloneExportResult> {
  const plan = buildStandaloneExportPlan(doc, options.cuts ?? []);
  assertStandaloneExportable(plan.fidelity);
  const fontResults = await ensureMotionFonts(motionFontAssetsFromPayloads(doc.materials.map((material) => material.payload)));
  const missingFonts = fontResults.filter((result) => !result.loaded);
  if (missingFonts.length > 0) {
    throw new StandaloneExportFidelityError({
      ...plan.fidelity,
      errors: [
        ...plan.fidelity.errors,
        ...missingFonts.map((font) => ({
          severity: "error" as const,
          code: "MOTION_FONT_LOAD_FAILED",
          message: `No se pudo cargar la fuente «${font.family}» para exportar exactamente el video.`,
        })),
      ],
    });
  }
  const audio = await Promise.all(plan.audio.map(loadAudio));
  const animation = defaultAnimation(doc.project.canvas_w, doc.project.canvas_h);
  animation.timeline.durationSec = plan.durationSec;
  animation.timeline.fps = doc.project.fps;
  const result = await exportReelVideo({
    // Una toma vacía sostiene el canvas. Los materiales standalone se
    // componen por encima desde su timeline real, sin convertirlos a slides.
    frames: [{
      id: doc.project.id,
      html: "<div></div>",
      css: "html,body,#__df_content{margin:0;width:100%;height:100%;background:#000}",
      width: doc.project.canvas_w,
      height: doc.project.canvas_h,
      background: "#000000",
      animation,
    }],
    project: { width: doc.project.canvas_w, height: doc.project.canvas_h, bg: "#000000" },
    fps: doc.project.fps,
    scale: options.scale ?? 1,
    format: options.format ?? "webm",
    mediaClips: plan.media.length ? plan.media : undefined,
    texts: plan.texts.length ? plan.texts : undefined,
    overlays: plan.overlays.length ? plan.overlays : undefined,
    sceneClips: plan.scenes.length ? plan.scenes : undefined,
    audioTracks: audio.length ? audio : undefined,
    onProgress: options.onProgress,
  });
  return { ...result, fidelity: plan.fidelity };
}

export { downloadVideoBlob };
