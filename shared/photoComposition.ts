/**
 * photoComposition — REQ-PHOTO-FASE4 (Modo Composición, v1).
 *
 * Modelo de capas raster sobre la foto activa, estilo Photoshop/Photopea:
 * cada capa es un lienzo de pintura (PNG transparente) con blend mode,
 * opacity, visibilidad y transform (offset/scale/rotación). El base SIEMPRE
 * es la foto revelada (receta develop); las capas componen ARRIBA.
 *
 * Render: en vivo por DOM (canvas 2D + CSS mix-blend-mode — los nombres de
 * blend de CSS y de canvas globalCompositeOperation son los mismos), y el
 * aplanado para exportar usa un canvas 2D con globalCompositeOperation.
 * Decisión estable-documentada: sin shader multi-textura en v1.
 *
 * Persistencia: photo_compositions (migración v60) — una fila por
 * (workspace_id, source_url) con layers_json; el contenido de cada capa viaja
 * como dataUrl PNG dentro del propio objeto de capa.
 */

export const COMPOSITION_SCHEMA_VERSION = 1;

/** Límite de capas por composición (defensiva, también en el API). */
export const MAX_COMPOSITION_LAYERS = 12;

/** Límite por dataUrl de capa (chars, ~2.25MB de PNG) — también en el API. */
export const MAX_LAYER_DATAURL_CHARS = 3_000_000;

export type CompositionBlend =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "difference"
  | "exclusion"
  | "soft-light"
  | "hard-light"
  | "color-dodge"
  | "color-burn"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity";

/** Los 16 blends con primitiva nativa idéntica en CSS mix-blend-mode y en
 * canvas globalCompositeOperation (normal ≙ source-over). Los 11 restantes
 * de Photoshop (dissolve, linear-burn, lighter-color, linear-dodge,
 * linear-light, pin-light, vivid-light, hard-mix, pass-through,
 * darken-color, subtract) NO tienen equivalente CSS/canvas — requieren
 * shader multi-textura y quedan fuera del esquema hasta esa decisión. */
export const COMPOSITION_BLENDS: readonly CompositionBlend[] = [
  "normal", "multiply", "screen", "overlay", "darken", "lighten", "difference", "exclusion",
  "soft-light", "hard-light", "color-dodge", "color-burn", "hue", "saturation", "color", "luminosity",
] as const;

/** CSS mix-blend-mode: "normal" existe; canvas: "normal" NO — mapear. */
export function blendToCanvasOp(blend: CompositionBlend): GlobalCompositeOperation {
  return blend === "normal" ? "source-over" : (blend as GlobalCompositeOperation);
}

export interface CompositionLayerTransform {
  /** offset en fracción del tamaño de salida (0.5 = media imagen) */
  x: number;
  y: number;
  /** 0.1..8 */
  scale: number;
  /** grados, -180..180 */
  rotation: number;
}

/** Definición viva de una capa de texto (re-editable): el render rasteriza
 * en el master de la capa y el dataUrl persiste los píxeles tal cual. */
export interface CompositionLayerText {
  value: string;
  /** cuerpo en px de pantalla al crear */
  size: number;
  color: string;
  font: string;
  /** posición normalizada de la línea base */
  x: number;
  y: number;
}

export interface CompositionLayer {
  id: string;
  name: string;
  kind: "paint" | "text";
  /** presente solo en capas de texto */
  text?: CompositionLayerText;
  blend: CompositionBlend;
  /** 0..1 */
  opacity: number;
  visible: boolean;
  transform: CompositionLayerTransform;
  /** PNG transparente del trazo (vacío = capa recién creada, aún sin pintar) */
  dataUrl: string;
}

export function createPaintLayer(index: number): CompositionLayer {
  return {
    id: `capa_${Date.now().toString(36)}_${index}`,
    name: `Capa ${index + 1}`,
    kind: "paint",
    blend: "normal",
    opacity: 1,
    visible: true,
    transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    dataUrl: "",
  };
}

/** Capa de texto viva: misma firma de persistencia, re-editable. */
export function createTextLayer(index: number, text: CompositionLayerText): CompositionLayer {
  return { ...createPaintLayer(index), kind: "text", name: "Texto", text };
}

const clamp = (v: number, min: number, max: number): number =>
  Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min;

function normalizeTransform(raw: unknown): CompositionLayerTransform {
  const t = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    x: clamp(Number(t.x) || 0, -2, 2),
    y: clamp(Number(t.y) || 0, -2, 2),
    scale: clamp(Number(t.scale) || 1, 0.1, 8),
    rotation: clamp(Number(t.rotation) || 0, -180, 180),
  };
}

/** Única puerta de entrada: clampa, rellena defaults y descarta lo inválido.
 * Orden del array = orden de apilado (último = más arriba). */
export function normalizeCompositionLayers(raw: unknown): CompositionLayer[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_COMPOSITION_LAYERS).flatMap((item): CompositionLayer[] => {
    const r = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const blend = COMPOSITION_BLENDS.includes(r.blend as CompositionBlend)
      ? (r.blend as CompositionBlend) : "normal";
    const dataUrl = typeof r.dataUrl === "string" && r.dataUrl.startsWith("data:image/")
      ? r.dataUrl.slice(0, MAX_LAYER_DATAURL_CHARS) : "";
    if (!dataUrl && r.persisted === true) return []; // capa persistida sin contenido: inválida (paint o text)
    const kind = r.kind === "text" ? "text" : "paint";
    let text: CompositionLayerText | undefined;
    if (kind === "text" && r.text && typeof r.text === "object") {
      const t = r.text as Record<string, unknown>;
      text = {
        value: typeof t.value === "string" ? t.value.slice(0, 5000) : "",
        size: clamp(Number(t.size) || 48, 4, 800),
        color: typeof t.color === "string" && /^#[0-9a-fA-F]{6}$/.test(t.color) ? t.color : "#e8e2d4",
        font: typeof t.font === "string" ? t.font.slice(0, 80) : "Inter, system-ui, sans-serif",
        x: clamp(Number(t.x) || 0, -1, 2),
        y: clamp(Number(t.y) || 0, -1, 2),
      };
    }
    return [{
      id: typeof r.id === "string" && /^[\w-]{1,64}$/.test(r.id) ? r.id : `capa_${Math.random().toString(36).slice(2, 10)}`,
      name: typeof r.name === "string" ? r.name.slice(0, 60) : "Capa",
      kind,
      ...(text ? { text } : {}),
      blend,
      opacity: clamp(Number(r.opacity) ?? 1, 0, 1),
      visible: r.visible !== false,
      transform: normalizeTransform(r.transform),
      dataUrl,
    }];
  });
}
