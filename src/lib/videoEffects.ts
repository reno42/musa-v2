/**
 * videoEffects — catálogo builtin + helpers PUROS de preview (REQ-VID14).
 *
 * El contrato del manifest vive en api/src/services/videoProjects.ts
 * (BUILTIN_VIDEO_EFFECTS / resolveEffectPayload). Este módulo es el ESPEJO
 * CLIENTE (el service arrastra node:crypto + Supabase y no se puede importar
 * desde la UI) con los MISMOS ids/zorders — el QA prueba que jamás se
 * separan. Fase 1 sin shaders: la preview se resuelve con DOM/CSS
 * (CSS filter, overlay con blend, caption animado y sticker con keyframes
 * interpolados) sobre el mismo player del editor (VideoPreview).
 */
import type { CSSProperties } from "react";
import type { VideoMaterial, VideoProjectDoc, VideoSegment } from "./videoProjectStore";

export interface BuiltinEffect {
  id: string;
  label: string;
  type: string;
  zorder: number;
  hint: string;
  defaults: Record<string, unknown>;
}

/** Espejo EXACTO de BUILTIN_VIDEO_EFFECTS del service (ids, types, zorder,
 *  TAMBIÉN el orden — el QA pinta que jamás se separan). */
export const CLIENT_BUILTIN_EFFECTS: BuiltinEffect[] = [
  {
    id: "fx-overlay", label: "Overlay de color", type: "ScriptInfoSticker", zorder: 60,
    hint: "veladura con blend mode",
    defaults: { color: "rgba(0,0,0,0.35)", blend: "normal" },
  },
  {
    id: "fx-lut", label: "Filtro LUT (CSS)", type: "AmazingFeature", zorder: 55,
    hint: "saturate / contrast / sepia sobre el clip",
    defaults: { css: "saturate(1.25) contrast(1.06)" },
  },
  {
    id: "fx-text-anim", label: "Texto animado (caption)", type: "InfoSticker", zorder: 70,
    hint: "fade / slide-up / pop / typewriter",
    defaults: { text: "Texto animado", anim: "fade", style: {} },
  },
  {
    id: "fx-sticker-kf", label: "Sticker con keyframes", type: "ScriptInfoSticker", zorder: 65,
    hint: "posición/escala/rotación por tiempo",
    defaults: { url: "", keyframes: [{ tUs: 0, x: 0, y: 0, scale: 1, rotation: 0, alpha: 1 }] },
  },
];

export function clientBuiltinById(effectId: string): BuiltinEffect | null {
  return CLIENT_BUILTIN_EFFECTS.find((e) => e.id === effectId) ?? null;
}

/** Shape del payload de un material kind=effect (lo arma
 *  resolveEffectPayload en el service; acá solo se lee). */
export interface EffectPayload {
  manifest: {
    name: string;
    type: string;
    zorder?: number;
    scriptPath?: string;
    resources?: Record<string, unknown>;
  };
  params: Record<string, unknown>;
  builtin?: boolean;
}

export function effectPayloadOf(m: VideoMaterial | null): EffectPayload | null {
  if (!m || m.kind !== "effect") return null;
  const p = m.payload as Partial<EffectPayload> | undefined;
  if (!p || typeof p !== "object" || typeof p.manifest !== "object" || p.manifest === null) return null;
  const manifest = p.manifest as EffectPayload["manifest"];
  if (typeof manifest.name !== "string" || typeof manifest.type !== "string") return null;
  return {
    manifest,
    params: (p.params && typeof p.params === "object" ? p.params : {}) as Record<string, unknown>,
    builtin: Boolean(p.builtin),
  };
}

/** Companions kind=effect de un segmento, resueltos contra el diccionario. */
export function effectsForSegment(
  doc: VideoProjectDoc,
  seg: VideoSegment,
): Array<{ materialId: string; effect: EffectPayload }> {
  const byId = new Map(doc.materials.map((m) => [m.id, m]));
  const out: Array<{ materialId: string; effect: EffectPayload }> = [];
  for (const refId of seg.extra_refs ?? []) {
    const effect = effectPayloadOf(byId.get(refId) ?? null);
    if (effect) out.push({ materialId: refId, effect });
  }
  return out;
}

// ── Sanitizado: la preview mete estos valores en style= — nada de url() ────

const SAFE_CSS_CHARS = /^[a-zA-Z0-9#(),.%\s_-]*$/;

/** CSS filter del LUT (fx-lut): passthrough con lista blanca de caracteres. */
export function lutFilterCss(params: Record<string, unknown>): string | null {
  const css = typeof params.css === "string" ? params.css.trim() : "";
  if (!css || css.length > 200 || !SAFE_CSS_CHARS.test(css) || /url\(/i.test(css)) return null;
  return css;
}

const BLEND_MODES = [
  "normal", "multiply", "screen", "overlay", "darken", "lighten",
  "color-dodge", "color-burn", "hard-light", "soft-light",
  "difference", "exclusion", "hue", "saturation", "color", "luminosity",
] as const;

/** Estilo del overlay (fx-overlay): color + blend mode validados. */
export function overlayStyle(params: Record<string, unknown>): CSSProperties {
  const rawColor = typeof params.color === "string" ? params.color.trim() : "";
  const color = rawColor && rawColor.length <= 60 && SAFE_CSS_CHARS.test(rawColor) && !/url\(/i.test(rawColor)
    ? rawColor
    : "rgba(0,0,0,0.35)";
  const blend = BLEND_MODES.includes(params.blend as (typeof BLEND_MODES)[number])
    ? (params.blend as CSSProperties["mixBlendMode"])
    : "normal";
  return { background: color, mixBlendMode: blend };
}

export const TEXT_ANIM_MODES = ["fade", "slide-up", "pop", "typewriter"] as const;

/** Clase de animación del caption (fx-text-anim); la animación arranca al
 *  montar (el player re-monta cuando el clip pasa a estar activo). */
export function textAnimClass(params: Record<string, unknown>): string {
  const anim = TEXT_ANIM_MODES.includes(params.anim as (typeof TEXT_ANIM_MODES)[number])
    ? (params.anim as string)
    : "fade";
  return `vp-fx-anim-${anim}`;
}

/** Estilos inline del caption (fx-text-anim params.style, saneado). */
export function textAnimInlineStyle(params: Record<string, unknown>): CSSProperties {
  const style = params.style;
  if (!style || typeof style !== "object" || Array.isArray(style)) return {};
  const out: CSSProperties = {};
  const raw = style as Record<string, unknown>;
  if (typeof raw.color === "string" && raw.color.length <= 60 && SAFE_CSS_CHARS.test(raw.color) && !/url\(/i.test(raw.color)) {
    out.color = raw.color;
  }
  if (typeof raw.fontSize === "number" && Number.isFinite(raw.fontSize)) {
    // Round: 0.28 × 100 = 28.000000000000004 en float — el CSS no lleva basura.
    out.fontSize = `${Math.round(Math.min(0.28, Math.max(0.04, raw.fontSize)) * 100)}cqw`;
  }
  if (typeof raw.fontWeight === "number" && Number.isFinite(raw.fontWeight)) {
    out.fontWeight = Math.min(900, Math.max(100, Math.round(raw.fontWeight)));
  }
  return out;
}

export interface StickerKeyframe {
  tUs: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  alpha: number;
}

const kf = (raw: unknown, tUs: number): StickerKeyframe => {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, def: number) => (typeof v === "number" && Number.isFinite(v) ? v : def);
  return {
    tUs,
    x: num(r.x, 0),
    y: num(r.y, 0),
    scale: num(r.scale, 1),
    rotation: num(r.rotation, 0),
    alpha: Math.min(1, Math.max(0, num(r.alpha, 1))),
  };
};

/** Keyframes normalizados y ordenados por tUs (mínimo 1 = identidad). */
export function stickerKeyframes(params: Record<string, unknown>): StickerKeyframe[] {
  const list = Array.isArray(params.keyframes) ? params.keyframes : [];
  const norm = list
    .slice(0, 64)
    .map((raw, i) => kf(raw, typeof (raw as { tUs?: unknown })?.tUs === "number" ? (raw as { tUs: number }).tUs : i * 500_000))
    .sort((a, b) => a.tUs - b.tUs);
  return norm.length > 0 ? norm : [kf(null, 0)];
}

/** Interpolación lineal entre keyframes, clampeada en los extremos. */
export function stickerTransformAt(kfs: StickerKeyframe[], tUs: number): StickerKeyframe {
  if (kfs.length === 0) return kf(null, 0);
  if (tUs <= kfs[0].tUs) return kfs[0];
  const last = kfs[kfs.length - 1];
  if (tUs >= last.tUs) return last;
  for (let i = 1; i < kfs.length; i++) {
    const b = kfs[i];
    if (tUs <= b.tUs) {
      const a = kfs[i - 1];
      const span = Math.max(1, b.tUs - a.tUs);
      const t = (tUs - a.tUs) / span;
      const lerp = (from: number, to: number) => from + (to - from) * t;
      return {
        tUs,
        x: lerp(a.x, b.x),
        y: lerp(a.y, b.y),
        scale: lerp(a.scale, b.scale),
        rotation: lerp(a.rotation, b.rotation),
        alpha: lerp(a.alpha, b.alpha),
      };
    }
  }
  return last;
}

/** Posición/transform del sticker en el stage: x/y normalizados -1..1 → %,
 *  centro del sticker anclado al punto (como CapCut). */
export function stickerPlacementStyle(kfAt: StickerKeyframe): CSSProperties {
  const clamp1 = (v: number) => Math.min(1, Math.max(-1, v));
  return {
    left: `${((clamp1(kfAt.x) + 1) / 2) * 100}%`,
    top: `${((clamp1(kfAt.y) + 1) / 2) * 100}%`,
    transform: `translate(-50%, -50%) rotate(${kfAt.rotation}deg) scale(${Math.min(8, Math.max(0.01, kfAt.scale))})`,
    opacity: kfAt.alpha,
  };
}
