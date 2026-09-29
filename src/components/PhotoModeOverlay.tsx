/**
 * PhotoModeOverlay — "Modo Foto" (REQ-PHOTO-PLATFORM-001, Fase 1).
 *
 * EMBEDDED en el canvas-area (mismo patrón que VideoModeOverlay): sustituye
 * el lienzo del diseño y conserva la top bar. Layout Lightroom:
 *   • Izquierda — tira de fotos raster del diseño (filmstrip) + histograma.
 *   • Centro — visor WebGL2 (zoom/pan), antes/después con split, crop y
 *     pincel de máscara.
 *   • Derecha — inspector: Luz · Color (curvas + HSL + grading) · Detalle ·
 *     Efectos · Máscaras · Recetas (presets, historial de versiones, rating).
 *   • Barra de salida (REQ §5): aplicar variante a la capa / a todas las
 *     instancias (con confirmación) · guardar receta · exportar · descartar.
 *
 * Invariantes: cada slider es SOLO estado local (cero red en el camino del
 * slider); el original nunca se toca (la variante es una rendition nueva);
 * una misma foto en varias capas puede tener variantes distintas.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FrameData, HtmlCanvasObject } from "./DesignFrame";
import { apiFetch } from "../lib/supabase";
import { PhotoRenderer, loadPhotoSource, type HistogramData, type RenderView } from "../lib/photoEngine";
import {
  applyPreset, createDefaultRecipe, decodeRecipeAttr, displayRectToSourceRect, encodeRecipeAttr,
  normalizeRecipe, PHOTO_PRESETS, recipeHasEdits, resolveOutputSize,
  type AnyRecipe, type GeometryParams, type MaskKind, type NormRect, type PhotoMask, type ToneCurveParams,
} from "../../shared/photoRecipe.ts";
import { collectPhotoTargets, groupTargetsBySrc, assetIdFromUrl, type PhotoTarget } from "../../shared/photoTargets.ts";
import {
  blendToCanvasOp, createPaintLayer, createTextLayer, MAX_COMPOSITION_LAYERS, normalizeCompositionLayers,
  type CompositionLayer, type CompositionLayerAdjust, type CompositionLayerTransform,
} from "../../shared/photoComposition";
import { PhotoLibraryPanel } from "./PhotoLibraryPanel";
import { PhotoComposePanel } from "./PhotoComposePanel";
import {
  PhotoToolRail, GROUP_BY_ID, GROUP_BY_KEY, defaultVariantOf, findVariant, isPaintTool,
  type PhotoGroupId,
} from "./PhotoToolRail";

// ── Local idiom (mismo look que VideoModeOverlay) ──

const smallBtn: React.CSSProperties = {
  fontSize: 10, padding: "3px 8px", borderRadius: 3,
  border: "1px solid rgba(200,184,152,0.15)", background: "rgba(200,184,152,0.05)",
  color: "#c8b898", cursor: "pointer", fontFamily: "inherit",
};
const smallBtnActive: React.CSSProperties = {
  ...smallBtn, background: "rgba(200,184,152,0.22)", borderColor: "rgba(200,184,152,0.5)", color: "#f0e8d8",
};
const muted: React.CSSProperties = { fontSize: 10, lineHeight: 1.5, color: "#7a7668" };
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

// Fase 4.2c: familias por GRUPO (la barra de opciones se adapta al grupo activo;
// la variante afinan comportamientos, no qué campos se muestran)
const SIZE_GROUPS = new Set<PhotoGroupId>(["heal", "brush", "clone", "history", "eraser", "blur", "dodge", "pen", "shapes"]);
const OPACITY_GROUPS = new Set<PhotoGroupId>(["heal", "brush", "clone", "history", "eraser", "blur", "dodge", "gradient", "shapes", "pen"]);
const FLOW_GROUPS = new Set<PhotoGroupId>(["brush", "clone", "history", "eraser", "heal"]);
const SMOOTH_GROUPS = new Set<PhotoGroupId>(["brush"]);
const COLOR_GROUPS = new Set<PhotoGroupId>(["brush", "gradient", "shapes", "pen", "type"]);

/** "#rrggbb" → "r,g,b" para componer rgba(). */
const hexToRgb = (hex: string): string => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "232,226,212";
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
};

/** BBox normalizado de un polígono de puntos [x,y] en 0..1. */
const polyBBox = (pts: Array<[number, number]>): { x: number; y: number; w: number; h: number } => {
  const xs = pts.map(p => p[0]); const ys = pts.map(p => p[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  return { x: minX, y: minY, w: Math.max(0.001, Math.max(...xs) - minX), h: Math.max(0.001, Math.max(...ys) - minY) };
};

/** F4.2e: ajustes de capa → string de ctx.filter (espejo DOM y aplanado). */
const adjustFilterOf = (a: { brightness: number; contrast: number; saturation: number; hue: number }): string =>
  `brightness(${a.brightness}) contrast(${a.contrast}) saturate(${a.saturation}) hue-rotate(${a.hue}deg)`;

/** F4.2e: vértices de un polígono regular de N lados inscrito en el rect. */
const polygonPoints = (sides: number, cx: number, cy: number, rx: number, ry: number): Array<[number, number]> => {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < sides; i++) {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
    pts.push([cx + rx * Math.cos(ang), cy + ry * Math.sin(ang)]);
  }
  return pts;
};

/** F4.2e: formas personalizadas propias (siluetas en grilla 24×24, dibujo
 * propio — cero assets de terceros, cero emojis). */
const CUSTOM_SHAPES: Record<string, Array<[number, number]>> = {
  estrella: [[12, 1], [14.7, 8.4], [22.5, 8.6], [16.3, 13.4], [18.5, 20.9], [12, 16.5], [5.5, 20.9], [7.7, 13.4], [1.5, 8.6], [9.3, 8.4]],
  corazon: [[12, 21], [4.5, 14.5], [2, 9.5], [4.5, 4.8], [8.3, 4.2], [12, 7.8], [15.7, 4.2], [19.5, 4.8], [22, 9.5], [19.5, 14.5]],
  flecha: [[3, 9.5], [13.5, 9.5], [13.5, 5], [21, 12], [13.5, 19], [13.5, 14.5], [3, 14.5]],
  rayo: [[13.5, 2], [6, 13.5], [11, 13.5], [9.5, 22], [18, 10.5], [12.8, 10.5]],
  gota: [[12, 2], [16.8, 8.8], [19, 13], [19, 16], [16.4, 19.6], [12, 22], [7.6, 19.6], [5, 16], [5, 13], [7.2, 8.8]],
};

const drawCustomShapePath = (ctx: CanvasRenderingContext2D, id: string, x: number, y: number, w: number, h: number) => {
  const pts = CUSTOM_SHAPES[id] || CUSTOM_SHAPES.estrella;
  pts.forEach(([px, py], i) => (i === 0
    ? ctx.moveTo(x + (px / 24) * w, y + (py / 24) * h)
    : ctx.lineTo(x + (px / 24) * w, y + (py / 24) * h)));
  ctx.closePath();
};

/** F4.2d: snapshot completo del estado de Componer (capas + masters +
 * máscaras + capa activa) para el undo/redo propio del modo. */
type ComposeSnap = {
  layers: CompositionLayer[];
  activeId: string | null;
  /** F4.2e: etiqueta visible en el panel Historia */
  label: string;
  canvases: Array<[string, HTMLCanvasElement | null]>;
  masks: Array<[string, HTMLCanvasElement | null]>;
};
const clampByte = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

/** F4.2d: bbox de selección aditiva (unión de la previa y la nueva). */
const unionBBox = (
  a: { x: number; y: number; w: number; h: number } | null,
  b: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } => {
  if (!a) return b;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

export type PhotoTab = "luz" | "color" | "detalle" | "efectos" | "mascaras" | "recetas";

export interface PhotoModeOverlayProps {
  frames: FrameData[];
  canvasObjects: HtmlCanvasObject[];
  workspaceId: string;
  initialTarget: PhotoTarget | null;
  onClose: () => void;
  addToast: (msg: string, kind?: "success" | "error" | "info") => void;
  /** REQ §5 salida: crea la variante y reemplaza SOLO la capa actual. */
  onApplyToLayer: (target: PhotoTarget, variantUrl: string, recipeAttr: string) => void;
  /** REQ §5 + §2: reemplaza todas las capas con el MISMO src (confirmación en el overlay). */
  onApplyToAllInstances: (src: string, variantUrl: string, recipeAttr: string) => void;
}

// ── Slider (cero red: onChange solo sube estado) ──

function Slider(props: {
  label: string; value: number; min: number; max: number; step?: number;
  def?: number; onChange: (v: number) => void; onCommitStart?: () => void;
}) {
  const { label, value, min, max, step = 1, def = 0, onChange, onCommitStart } = props;
  return (
    <div style={{ marginBottom: 7 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#b0aa98" }}>
        <span>{label}</span>
        <span
          style={{ fontFamily: "monospace", cursor: def !== undefined ? "pointer" : "default" }}
          title={def !== undefined ? "Doble click: restablecer" : undefined}
          onDoubleClick={() => { if (value !== def) { onCommitStart?.(); onChange(def); } }}
        >
          {Math.round(value * 10) / 10}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onPointerDown={onCommitStart}
        onKeyDown={e => { if (e.key.startsWith("Arrow")) onCommitStart?.(); }}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: "100%", accentColor: "#c8b898", height: 14, cursor: "ew-resize" }}
      />
    </div>
  );
}

// ── Editor de curva por canal ──

function CurveEditor(props: {
  curves: ToneCurveParams;
  onChange: (next: ToneCurveParams) => void;
  onCommitStart: () => void;
}) {
  const { curves, onChange, onCommitStart } = props;
  const [channel, setChannel] = useState<"rgb" | "r" | "g" | "b">("rgb");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragIdx = useRef(-1);
  const W = 220, H = 130;
  const pts = curves[channel];

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#141414";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo((W / 4) * i, 0); ctx.lineTo((W / 4) * i, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, (H / 4) * i); ctx.lineTo(W, (H / 4) * i); ctx.stroke();
    }
    // diagonal de referencia
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(W, 0); ctx.stroke();
    const toPx = (p: { x: number; y: number }) => [p.x / 255 * W, H - p.y / 255 * H];
    ctx.strokeStyle = channel === "r" ? "#e06c5a" : channel === "g" ? "#7bbf6a" : channel === "b" ? "#5a8fe0" : "#e0d6c0";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i <= 32; i++) {
      const x = (i / 32) * 255;
      // eval con interpolación lineal de puntos ordenados (+extremos)
      const sorted = [...pts].sort((a, b) => a.x - b.x);
      let y: number;
      if (sorted.length === 0) y = x;
      else {
        if (x <= sorted[0].x) y = sorted[0].y;
        else if (x >= sorted[sorted.length - 1].x) y = sorted[sorted.length - 1].y;
        else {
          let k = 0;
          while (k < sorted.length - 2 && sorted[k + 1].x < x) k++;
          const t = (x - sorted[k].x) / Math.max(1e-6, sorted[k + 1].x - sorted[k].x);
          y = sorted[k].y + (sorted[k + 1].y - sorted[k].y) * t;
        }
      }
      const [px, py] = toPx({ x, y });
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.fillStyle = "#fff";
    for (const p of pts) {
      const [px, py] = toPx(p);
      ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();
    }
  }, [pts, channel]);

  const toPoint = (e: React.PointerEvent): { x: number; y: number } => {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    return {
      x: clamp(Math.round(((e.clientX - rect.left) / rect.width) * 255), 0, 255),
      y: clamp(Math.round((1 - (e.clientY - rect.top) / rect.height) * 255), 0, 255),
    };
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
        {(["rgb", "r", "g", "b"] as const).map(ch => (
          <button key={ch} type="button" onClick={() => setChannel(ch)}
            style={channel === ch ? smallBtnActive : smallBtn}>{ch.toUpperCase()}</button>
        ))}
        <div style={{ flex: 1 }} />
        <button type="button" style={smallBtn} title="Vaciar curva del canal"
          onClick={() => { onCommitStart(); onChange({ ...curves, [channel]: [] }); }}>Reset</button>
      </div>
      <canvas
        ref={canvasRef} width={W} height={H}
        style={{ width: "100%", borderRadius: 4, cursor: "crosshair", touchAction: "none" }}
        onPointerDown={e => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const p = toPoint(e);
          const hit = pts.findIndex(q => Math.abs(q.x - p.x) < 10 && Math.abs(q.y - p.y) < 12);
          if (hit >= 0) { dragIdx.current = hit; onCommitStart(); }
          else if (pts.length < 12) {
            onCommitStart();
            const next = [...pts, p].sort((a, b) => a.x - b.x);
            dragIdx.current = next.findIndex(q => q.x === p.x && q.y === p.y);
            onChange({ ...curves, [channel]: next });
          }
        }}
        onPointerMove={e => {
          if (dragIdx.current < 0) return;
          const p = toPoint(e);
          const next = pts.map((q, i) => (i === dragIdx.current ? p : q)).sort((a, b) => a.x - b.x);
          dragIdx.current = next.findIndex(q => q === p ? true : (q.x === p.x && q.y === p.y));
          onChange({ ...curves, [channel]: next });
        }}
        onPointerUp={() => { dragIdx.current = -1; }}
        onDoubleClick={e => {
          const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
          const p = {
            x: clamp(Math.round(((e.clientX - rect.left) / rect.width) * 255), 0, 255),
            y: clamp(Math.round((1 - (e.clientY - rect.top) / rect.height) * 255), 0, 255),
          };
          const hit = pts.findIndex(q => Math.abs(q.x - p.x) < 8);
          if (hit >= 0) { onCommitStart(); onChange({ ...curves, [channel]: pts.filter((_, i) => i !== hit) }); }
        }}
      />
      <div style={muted}>Click: añadir punto · arrastrar: mover · doble click: borrar</div>
    </div>
  );
}

// ── Histograma ──

function HistogramView(props: { data: HistogramData | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d")!;
    const W = cv.width, H = cv.height;
    ctx.fillStyle = "#121212";
    ctx.fillRect(0, 0, W, H);
    if (!props.data) return;
    const drawChannel = (bins: Uint32Array, color: string) => {
      const peak = Math.max(1, ...bins.slice(1, 255));
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let i = 0; i < 256; i++) ctx.lineTo((i / 255) * W, H - (bins[i] / peak) * H);
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
    };
    drawChannel(props.data.r, "rgba(224,92,74,0.55)");
    drawChannel(props.data.g, "rgba(110,200,90,0.55)");
    drawChannel(props.data.b, "rgba(80,140,224,0.55)");
    drawChannel(props.data.l, "rgba(230,220,200,0.25)");
  }, [props.data]);
  return <canvas ref={ref} width={204} height={76} style={{ width: "100%", borderRadius: 4, background: "#121212" }} />;
}

// ── assetId derivado de la URL de storage: vive en shared/photoTargets.ts ──
// (misma derivación que API/MCP para escribir la misma fila del catálogo)

// ═══ Overlay principal ═══

export function PhotoModeOverlay({
  frames, canvasObjects, workspaceId, initialTarget, onClose, addToast,
  onApplyToLayer, onApplyToAllInstances,
}: PhotoModeOverlayProps) {
  // ── targets + activo ──
  const targets = useMemo(() => collectPhotoTargets(frames as any, canvasObjects as any), [frames, canvasObjects]);
  const groups = useMemo(() => groupTargetsBySrc(targets), [targets]);
  const [active, setActive] = useState<PhotoTarget | null>(() =>
    initialTarget || targets[0] || null);
  const [effectiveSrc, setEffectiveSrc] = useState<string>(active?.src || "");

  // ── receta + historial ──
  const [recipe, setRecipe] = useState<AnyRecipe>(() => createDefaultRecipe());
  const past = useRef<string[]>([]);
  const future = useRef<string[]>([]);
  const [histVersion, setHistVersion] = useState(0);
  const pendingSnapshot = useRef<string | null>(null);
  const [selectedMaskId, setSelectedMaskId] = useState<string | null>(null);

  const pushHistory = useCallback(() => {
    past.current.push(JSON.stringify(recipe));
    if (past.current.length > 60) past.current.shift();
    future.current = [];
    setHistVersion(v => v + 1);
  }, [recipe]);
  const snapshotForUndo = useCallback(() => {
    pendingSnapshot.current = JSON.stringify(recipe);
  }, [recipe]);
  const commitSnapshot = useCallback(() => {
    const snap = pendingSnapshot.current;
    pendingSnapshot.current = null;
    if (snap == null || snap === JSON.stringify(recipe)) return;
    past.current.push(snap);
    if (past.current.length > 60) past.current.shift();
    future.current = [];
    setHistVersion(v => v + 1);
  }, [recipe]);
  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (prev == null) return;
    future.current.push(JSON.stringify(recipe));
    setRecipe(normalizeRecipe(JSON.parse(prev)));
    setHistVersion(v => v + 1);
  }, [recipe]);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (next == null) return;
    past.current.push(JSON.stringify(recipe));
    setRecipe(normalizeRecipe(JSON.parse(next)));
    setHistVersion(v => v + 1);
  }, [recipe]);

  // ── fuente + renderer ──
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<PhotoRenderer | null>(null);
  const brushCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [glError, setGlError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creatingCopy, setCreatingCopy] = useState(false);
  const [srcVersion, setSrcVersion] = useState(0); // invalidate al cambiar la fuente
  const [imgDims, setImgDims] = useState<{ w: number; h: number } | null>(null);

  // ── vista / modos ──
  const [view, setView] = useState<RenderView>({ zoom: 1, panX: 0, panY: 0 });
  const [mode, setMode] = useState<"edit" | "crop" | "brush" | "compose">("edit");
  const [split, setSplit] = useState<number | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [cropDraft, setCropDraft] = useState<NormRect>({ x: 0, y: 0, w: 1, h: 1 });
  const [aspect, setAspect] = useState<number | null>(null);
  const [tab, setTab] = useState<PhotoTab>("luz");
  const [histogram, setHistogram] = useState<HistogramData | null>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const [busy, setBusy] = useState(false);
  // panel izquierdo: filmstrip del diseño o Biblioteca (catálogo del workspace)
  const [leftTab, setLeftTab] = useState<"fotos" | "biblioteca">("fotos");

  // ── Fase 4: composición por capas (stack DOM + masters offscreen) ──
  const [composeLayers, setComposeLayers] = useState<CompositionLayer[]>([]);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  // Fase 4.2c: herramienta activa por GRUPO + variante elegida por grupo
  // (los ids de variante colisionan entre grupos: "rect" vive en marco y en formas)
  const [tool, setTool] = useState<PhotoGroupId>("move");
  const [toolVariants, setToolVariants] = useState<Record<string, string>>({});
  const [toolNotice, setToolNotice] = useState<string | null>(null);
  const [paintColor, setPaintColor] = useState("#e8e2d4");
  const [paintSize, setPaintSize] = useState(28);
  const [paintOpacity, setPaintOpacity] = useState(0.85);
  const [paintFlow, setPaintFlow] = useState(1); // Flujo: acumulación del trazo
  const [paintSmooth, setPaintSmooth] = useState(0); // Suavizar: el trazo persigue al puntero
  const [typeSize, setTypeSize] = useState(48);
  const [typeFont, setTypeFont] = useState("Inter, system-ui, sans-serif");
  const [paintHardness, setPaintHardness] = useState(35); // Dureza 0-100 (plataforma del gradiente de punta)
  const [selFeather, setSelFeather] = useState(0); // px de pantalla — difumina el borde al commit
  const [bgColor, setBgColor] = useState("#000000"); // color de fondo (X alterna · D restablece)
  const [wandTolerance, setWandTolerance] = useState(32);
  const [composeDirty, setComposeDirty] = useState(false);
  const [composeSaving, setComposeSaving] = useState(false);
  const [composeTick, setComposeTick] = useState(0); // re-render para refrescar los espejos DOM
  const layerCanvasesRef = useRef<Map<string, HTMLCanvasElement>>(new Map()); // masters (fuente de verdad)
  const mirrorCanvasesRef = useRef<Map<string, HTMLCanvasElement>>(new Map()); // canvas del stack DOM
  const lastPaintPt = useRef<{ x: number; y: number } | null>(null);
  const activeComposeLayer = composeLayers.find(l => l.id === activeLayerId) || null;
  // Fase 4.2c: variante activa del grupo (la última usada o la por defecto)
  const toolVariant = toolVariants[tool] || defaultVariantOf(tool);

  // Fase 4.2b: snapshot del revelado (clonar/corrector/parche/cuentagotas),
  // máscara de selección (marco/lazo/varita) y estado del tampón
  const snapshotRef = useRef<HTMLCanvasElement | null>(null);
  const selectionMaskRef = useRef<HTMLCanvasElement | null>(null);
  const [selectionBBox, setSelectionBBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [selPreview, setSelPreview] = useState<
    { kind: "rect" | "ellipse"; x: number; y: number; w: number; h: number }
    | { kind: "poly"; pts: Array<[number, number]> }
    | { kind: "line"; x1: number; y1: number; x2: number; y2: number }
    | null
  >(null);
  // Fase 4.2c: borradores de las tools que no arrastran (texto y pluma)
  const [typeDraft, setTypeDraft] = useState<{ x: number; y: number; value: string } | null>(null);
  const [penPts, setPenPts] = useState<Array<[number, number]>>([]);
  // F4.2d: máscaras de capa (sesión) + su modo de pintura, transformación libre
  // (Ctrl+T), pan temporal con espacio, cursor circular del pincel y
  // undo/redo propio de la composición
  const layerMasksRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const [maskEditId, setMaskEditId] = useState<string | null>(null);
  const [tfDraft, setTfDraft] = useState<CompositionLayerTransform | null>(null);
  const tfModeRef = useRef<"scale" | "rotate" | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const brushCursorRef = useRef<HTMLDivElement | null>(null);
  const selModeRef = useRef<"new" | "add" | "sub">("new");
  const composePast = useRef<ComposeSnap[]>([]);
  const composeFuture = useRef<ComposeSnap[]>([]);
  const composeLayersRef = useRef(composeLayers);
  composeLayersRef.current = composeLayers;
  const sharpenStroke = useRef<{ bbox: { x0: number; y0: number; x1: number; y1: number }; before: HTMLCanvasElement; layerId: string } | null>(null);
  const lastMetaPush = useRef(0);
  const cloneSrcRef = useRef<{ x: number; y: number } | null>(null); // normalizado
  const cloneOffsetRef = useRef<{ x: number; y: number } | null>(null); // px de master
  const scratchRef = useRef<HTMLCanvasElement | null>(null);
  const composeLoadedRef = useRef(false);
  // F4.2e: portapapeles de selección, selección guardada, máscara rápida (Q),
  // tampón de patrón, SAM de Selección rápida y el tick del panel Historia
  const clipboardRef = useRef<HTMLCanvasElement | null>(null);
  const savedSelectionRef = useRef<{ mask: HTMLCanvasElement; bbox: { x: number; y: number; w: number; h: number } } | null>(null);
  const [hasSavedSel, setHasSavedSel] = useState(false);
  const [typeVertical, setTypeVertical] = useState(false);
  const [shapeSides, setShapeSides] = useState(6);
  const [customShapeId, setCustomShapeId] = useState("estrella");
  const [patternKind, setPatternKind] = useState("cuadros");
  const [patternTile, setPatternTile] = useState(24);
  const patternTileRef = useRef<{ key: string; cv: HTMLCanvasElement } | null>(null);
  const [qmask, setQmask] = useState(false);
  const qmaskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const qmaskMirrorRef = useRef<HTMLCanvasElement | null>(null);
  const [samBusy, setSamBusy] = useState(false);
  const [histTick, setHistTick] = useState(0);

  // ── API: documento + versiones + catálogo ──
  const [docId, setDocId] = useState<string | null>(null);
  const [versions, setVersions] = useState<Array<{ id: string; label: string; created_at: string; recipe_json: AnyRecipe }>>([]);
  const [rating, setRating] = useState(0);
  const [flag, setFlag] = useState<"pick" | "reject" | "unflagged">("unflagged");

  const outSize = useMemo(() => {
    if (!imgDims) return { w: 1, h: 1 };
    return resolveOutputSize(imgDims.w, imgDims.h, recipe.geometry);
  }, [imgDims, recipe.geometry]);

  // rect de la imagen EN CSS px dentro del stage (para crop/split/brush)
  const imgRect = useMemo(() => {
    if (!canvasSize.w || !canvasSize.h) return { left: 0, top: 0, width: 0, height: 0 };
    const scale = Math.min(canvasSize.w / outSize.w, canvasSize.h / outSize.h) * view.zoom;
    return {
      left: (canvasSize.w - outSize.w * scale) / 2 - view.panX,
      top: (canvasSize.h - outSize.h * scale) / 2 - view.panY,
      width: outSize.w * scale,
      height: outSize.h * scale,
    };
  }, [canvasSize, outSize, view]);

  // ── init renderer una vez ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!PhotoRenderer.isSupported()) {
      setGlError("Este navegador no soporta WebGL2 — el Modo Foto necesita WebGL2.");
      return;
    }
    const boot = (): boolean => {
      try {
        rendererRef.current?.dispose();
      } catch { /* contexto previo muerto: se ignora */ }
      try {
        rendererRef.current = new PhotoRenderer(canvas);
        return true;
      } catch (e: any) {
        setGlError(e?.message || "No se pudo inicializar WebGL2");
        return false;
      }
    };
    boot();
    // Pérdida de contexto WebGL (GPU saturada con texturas grandes): sin esto
    // el visor queda en negro de forma silenciosa. En restore re-creamos el
    // renderer y re-subimos la fuente.
    const onLost = (e: Event) => {
      e.preventDefault();
      setGlError("Se perdió el contexto WebGL2 (GPU saturada). Reintentando…");
    };
    const onRestored = () => {
      if (boot()) {
        setGlError(null);
        setSrcVersion(v => v + 1);
      }
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    return () => {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  // ── ResizeObserver del stage ──
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const ro = new ResizeObserver(() => {
      const r = stage.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      setCanvasSize({ w: Math.round(r.width * dpr), h: Math.round(r.height * dpr) });
    });
    ro.observe(stage);
    return () => ro.disconnect();
  }, []);

  const ensureBrushCanvas = useCallback(() => {
    if (!brushCanvasRef.current) {
      const cv = document.createElement("canvas");
      cv.width = 512; cv.height = 512;
      brushCanvasRef.current = cv;
    }
    return brushCanvasRef.current;
  }, []);

  const activeMask = recipe.masks.find(m => m.id === selectedMaskId) || null;
  const hasBrushMasks = recipe.masks.some(m => m.kind === "brush");

  // ── cargar fuente al cambiar el target ──
  useEffect(() => {
    if (!active || glError) return;
    let cancelled = false;
    setLoadError(null);
    setImgDims(null);
    setHistogram(null); // el histograma viejo es de OTRA foto: no confundir
    setEffectiveSrc(active.src);
    // receta embebida en la capa manda; si no, la última versión del documento
    let initialRecipe: AnyRecipe | null = active.recipeAttr ? decodeRecipeAttr(active.recipeAttr) : null;
    if (initialRecipe) setRecipe(initialRecipe);
    else {
      setRecipe(createDefaultRecipe());
      past.current = []; future.current = [];
    }
    setSelectedMaskId(null);
    setView({ zoom: 1, panX: 0, panY: 0 });
    setMode("edit");
    setSplit(null);
    // la composición es POR FOTO: al cambiar de target nunca arrastrar capas
    setComposeLayers([]);
    setActiveLayerId(null);
    setComposeDirty(false);
    layerCanvasesRef.current.clear();
    mirrorCanvasesRef.current.clear();
    // Fase 4.2b: snapshot/selección/tampón son de ESTA foto
    snapshotRef.current = null;
    selectionMaskRef.current = null;
    cloneSrcRef.current = null;
    cloneOffsetRef.current = null;
    scratchRef.current = null;
    composeLoadedRef.current = false;
    setSelectionBBox(null);
    setSelPreview(null);
    setTool("move");

    (async () => {
      try {
        const src = await loadPhotoSource(active.src);
        if (cancelled) return;
        setImgDims({ w: src.width, h: src.height });
        rendererRef.current?.setSource(src.bitmap, src.width, src.height);
        setSrcVersion(v => v + 1);
      } catch {
        if (cancelled) return;
        setLoadError("No se pudo abrir la foto desde su origen (CORS o URL inaccesible).");
      }
      // historial remoto (no bloquea el editor)
      if (!initialRecipe && workspaceId) {
        try {
          const res = await apiFetch<any>(`/api/photos/documents?workspaceId=${encodeURIComponent(workspaceId)}&sourceUrl=${encodeURIComponent(active.src)}`);
          const doc = res?.document;
          if (!cancelled && doc) {
            setDocId(doc.id);
            setVersions(res.versions || []);
            const activeV = (res.versions || []).find((v: any) => v.id === doc.active_version_id) || (res.versions || [])[0];
            if (activeV?.recipe_json) setRecipe(normalizeRecipe(activeV.recipe_json));
          } else if (!cancelled) setDocId(null);
        } catch { /* sin historial */ }
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.src, glError]);

  // ── Fase 4: decodifica dataUrls guardados dentro de los masters ──
  useEffect(() => {
    let alive = true;
    for (const layer of composeLayers) {
      if (!layer.dataUrl) continue;
      const sizeKey = `${Math.max(1, Math.min(2048, Math.round(outSize.w)))}x${Math.max(1, Math.min(2048, Math.round(outSize.h)))}`;
      const master = ensureMasterCanvas(layer.id);
      if (master.dataset.loaded === sizeKey) continue;
      master.dataset.loaded = sizeKey;
      const img = new Image();
      img.onload = () => {
        if (!alive) return;
        const m2 = layerCanvasesRef.current.get(layer.id); // pudo re-crearse en resize
        const ctx = m2?.getContext("2d");
        if (ctx && m2) { ctx.clearRect(0, 0, m2.width, m2.height); ctx.drawImage(img, 0, 0, m2.width, m2.height); }
        setComposeTick(t => t + 1);
      };
      img.src = layer.dataUrl;
    }
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composeLayers, outSize.w, outSize.h]);

  // ── Fase 4: espejo maestro→DOM (el stack del stage son mirrors) ──
  useEffect(() => {
    for (const layer of composeLayers) {
      const dom = mirrorCanvasesRef.current.get(layer.id);
      const master = layerCanvasesRef.current.get(layer.id);
      if (!dom || !master) continue;
      if (dom.width !== master.width || dom.height !== master.height) { dom.width = master.width; dom.height = master.height; }
      const ctx = dom.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, dom.width, dom.height);
        // F4.2e: ajustes no destructivos por capa (ctx.filter)
        if (layer.adjust) ctx.filter = adjustFilterOf(layer.adjust);
        ctx.drawImage(master, 0, 0);
        if (layer.adjust) ctx.filter = "none";
        // F4.2d: máscara de capa — visible solo donde la máscara es opaca
        const mk = layerMasksRef.current.get(layer.id);
        if (mk) {
          ctx.globalCompositeOperation = "destination-in";
          ctx.drawImage(mk, 0, 0);
          ctx.globalCompositeOperation = "source-over";
        }
      }
    }
  }, [composeLayers, composeTick]);

  // ── F4.2e: overlay rojo de la máscara rápida (lo pintado = NO seleccionado) ──
  useEffect(() => {
    const dom = qmaskMirrorRef.current;
    if (!dom) return;
    const ctx = dom.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, dom.width, dom.height);
    const src = qmask ? qmaskCanvasRef.current : null;
    if (src) {
      if (dom.width !== src.width || dom.height !== src.height) { dom.width = src.width; dom.height = src.height; }
      ctx.drawImage(src, 0, 0);
      ctx.globalCompositeOperation = "source-in";
      ctx.fillStyle = "rgba(255,64,64,0.55)";
      ctx.fillRect(0, 0, dom.width, dom.height);
      ctx.globalCompositeOperation = "source-over";
    }
  }, [qmask, composeTick, histTick]);

  // ── render principal (solo estado: cero red) ──
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || glError || !imgDims) return;
    if (canvasRef.current && (canvasRef.current.width !== canvasSize.w || canvasRef.current.height !== canvasSize.h)) {
      canvasRef.current.width = canvasSize.w;
      canvasRef.current.height = canvasSize.h;
    }
    renderer.update(recipe, { view, split, original: showOriginal });
    const t = setTimeout(() => {
      setHistogram(renderer.update(recipe, { view, split, original: showOriginal, histogram: true }));
    }, 220);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe, view, split, showOriginal, canvasSize, imgDims, srcVersion, glError]);

  // ── subir lienzo de pincel cuando hay máscaras brush ──
  useEffect(() => {
    if (brushCanvasRef.current && hasBrushMasks) rendererRef.current?.setBrushMask(brushCanvasRef.current);
  }, [hasBrushMasks, recipe.masks.length]);

  // ── interacción con el stage ──
  const drag = useRef<{ kind: "pan" | "split" | "crop-move" | "crop-resize" | "paint" | "layer-paint" | "layer-move" | "sel-rect" | "sel-ellipse" | "sel-lasso" | "patch-drag" | "gradient-drag" | "shape-rect" | "shape-ellipse" | "shape-line" | "shape-poly" | "shape-custom" | "pen-free" | "qmask-paint" | "mask-paint" | "tf-move" | "tf-drag"; startX: number; startY: number; base: any; corner?: string } | null>(null);

  const stagePointerDown = (e: React.PointerEvent) => {
    if (!imgDims || glError) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (split != null && mode === "edit") {
      drag.current = { kind: "split", startX: e.clientX, startY: e.clientY, base: split };
      return;
    }
    if (mode === "crop") {
      const p = displayPointToNorm(e);
      const d = cropDraft;
      const hit = hitCropHandle(p, d, 0.03);
      if (hit) drag.current = { kind: "crop-resize", startX: e.clientX, startY: e.clientY, base: { ...d }, corner: hit };
      else if (p.x >= d.x && p.x <= d.x + d.w && p.y >= d.y && p.y <= d.y + d.h)
        drag.current = { kind: "crop-move", startX: e.clientX, startY: e.clientY, base: { ...d } };
      return;
    }
    if (mode === "brush") {
      drag.current = { kind: "paint", startX: e.clientX, startY: e.clientY, base: null };
      paintAt(e);
      return;
    }
    // F4.2d: espacio mantiene la mano temporal con cualquier tool activa
    if (spaceDown) {
      drag.current = { kind: "pan", startX: e.clientX, startY: e.clientY, base: { ...view } };
      return;
    }
    // F4.2d: transformación libre activa — el clic dentro del stage mueve la capa
    if (tfDraft && mode === "compose" && activeLayerId) {
      drag.current = { kind: "tf-move", startX: e.clientX, startY: e.clientY, base: { ...tfDraft } };
      return;
    }
    // Fase 4.2c: herramientas estilo Photoshop por GRUPO + variante — las de
    // pintura cambian a compose solas; selección/cuentagotas/zoom en cualquier modo
    const variant = toolVariant;
    if (tool === "marquee") {
      // F4.2d: Shift añade a la selección · Alt quita (la previa sobrevive)
      selModeRef.current = e.shiftKey ? "add" : e.altKey ? "sub" : "new";
      if (selModeRef.current === "new") clearSelection();
      const p0 = displayPointToNorm(e);
      if (variant === "row" || variant === "col") { commitRowCol(p0, variant); return; }
      drag.current = { kind: variant === "ellipse" ? "sel-ellipse" : "sel-rect", startX: e.clientX, startY: e.clientY, base: p0 };
      return;
    }
    if (tool === "lasso") {
      const p0 = displayPointToNorm(e);
      if (variant === "poly") {
        // lazo poligonal: clics sucesivos; Enter cierra (onKey)
        if (!selPreview || selPreview.kind !== "poly") clearSelection();
        setSelPreview(prev => (prev && prev.kind === "poly"
          ? { kind: "poly", pts: [...prev.pts, [p0.x, p0.y]] }
          : { kind: "poly", pts: [[p0.x, p0.y]] }));
        return;
      }
      selModeRef.current = e.shiftKey ? "add" : e.altKey ? "sub" : "new";
      if (selModeRef.current === "new") clearSelection();
      drag.current = { kind: "sel-lasso", startX: e.clientX, startY: e.clientY, base: p0 };
      setSelPreview({ kind: "poly", pts: [[p0.x, p0.y]] });
      return;
    }
    if (tool === "quicksel" && variant === "quick") { // F4.2e: SAM real — Shift añade · Alt resta
      void samQuickSelect(displayPointToNorm(e), e.shiftKey ? "add" : e.altKey ? "sub" : "new");
      return;
    }
    if (tool === "quicksel") {
      selModeRef.current = e.shiftKey ? "add" : e.altKey ? "sub" : "new";
      buildWandMask(displayPointToNorm(e), selModeRef.current);
      return;
    }
    if (tool === "eyedropper") { pickColorAt(displayPointToNorm(e)); return; }
    if (tool === "zoom") {
      setView(v => ({ ...v, zoom: clamp(v.zoom * (e.altKey ? 1 / 1.3 : 1.3), 0.2, 12) }));
      return;
    }
    if (tool === "hand") {
      drag.current = { kind: "pan", startX: e.clientX, startY: e.clientY, base: { ...view } };
      return;
    }
    const enterCompose = () => {
      if (mode !== "compose") {
        setMode("compose");
        if (!composeLoadedRef.current) void loadComposition();
      }
      if (!composeLoadedRef.current) { addToast("Cargando composición…", "info"); return false; }
      return true;
    };
    if (tool === "type") {
      if (typeDraft) { commitType(); return; } // segundo clic = confirma el texto
      if (!enterCompose()) return;
      const p0 = displayPointToNorm(e);
      // F4.2d: clic sobre una capa de texto existente la reedita (capa viva)
      const hitText = [...composeLayers].reverse().find(l => l.kind === "text" && l.text
        && p0.x >= l.text.x - 0.02
        && p0.x <= l.text.x + Math.min(0.9, 0.012 * (l.text.size / 48) * l.text.value.split("\n").reduce((m, s) => Math.max(m, s.length), 4)) + 0.02
        && p0.y <= l.text.y + 0.02
        && p0.y >= l.text.y - 0.0016 * l.text.size * l.text.value.split("\n").length);
      if (hitText?.text) {
        setActiveLayerId(hitText.id);
        setTypeSize(Math.round(clamp(hitText.text.size, 8, 400)));
        setTypeFont(hitText.text.font);
        setPaintColor(hitText.text.color);
        setTypeDraft({ x: hitText.text.x, y: hitText.text.y, value: hitText.text.value });
        return;
      }
      setTypeDraft({ x: p0.x, y: p0.y, value: "" });
      return;
    }
    if (tool === "pen" && variant === "freeform") { // F4.2e: pluma libre — arrastra y suelta (despachada antes del bloque bloqueado por QA)
      if (!enterCompose()) return;
      const pf = displayPointToNorm(e);
      setPenPts([[pf.x, pf.y]]);
      drag.current = { kind: "pen-free", startX: e.clientX, startY: e.clientY, base: null };
      return;
    }
    if (tool === "pen") {
      if (!enterCompose()) return;
      const p0 = displayPointToNorm(e);
      setPenPts(pts => [...pts, [p0.x, p0.y]]);
      return;
    }
    if (tool === "shapes" && (variant === "polygon" || variant === "custom")) { // F4.2e: polígono y custom (despachados antes del ternario bloqueado por QA)
      if (!enterCompose()) return;
      drag.current = {
        kind: variant === "polygon" ? "shape-poly" : "shape-custom",
        startX: e.clientX, startY: e.clientY, base: displayPointToNorm(e),
      };
      return;
    }
    if (tool === "shapes") {
      if (!enterCompose()) return;
      drag.current = {
        kind: variant === "line" ? "shape-line" : variant === "ellipse" ? "shape-ellipse" : "shape-rect",
        startX: e.clientX, startY: e.clientY, base: displayPointToNorm(e),
      };
      return;
    }
    if (tool === "gradient" && variant !== "bucket") {
      if (!enterCompose()) return;
      drag.current = { kind: "gradient-drag", startX: e.clientX, startY: e.clientY, base: displayPointToNorm(e) };
      return;
    }
    if (isPaintTool(tool) || (tool === "move" && mode === "compose")) {
      if (isPaintTool(tool) && !enterCompose()) return;
      // F4.2e: máscara rápida activa — las tools de pintura editan el MODELO
      // de la selección (pintar añade · Alt borra)
      if (isPaintTool(tool) && qmask && tool !== "clone" && tool !== "heal" && tool !== "history") {
        drag.current = { kind: "qmask-paint", startX: e.clientX, startY: e.clientY, base: null };
        qmaskPaintAt(displayPointToNorm(e), e.altKey);
        return;
      }
      // F4.2d: con "Pintar máscara" activo, las tools de pintura escriben la
      // MÁSCARA de la capa elegida (trazo normal oculta · Alt revela)
      if (isPaintTool(tool) && maskEditId && tool !== "clone" && tool !== "heal" && tool !== "history") {
        pushComposeHistory();
        ensureLayerMask(maskEditId);
        drag.current = { kind: "mask-paint", startX: e.clientX, startY: e.clientY, base: { layerId: maskEditId } };
        setComposeDirty(true);
        paintLayerAt(e, maskEditId, { mask: true });
        return;
      }
      if (tool === "clone" && e.altKey) {
        cloneSrcRef.current = displayPointToNorm(e);
        cloneOffsetRef.current = null;
        addToast("Origen del tampón definido — pinta para clonar desde ahí.", "info");
        return;
      }
      if (tool === "heal" && variant === "patch" && !selectionMaskRef.current) {
        addToast("El parche necesita una selección: marco (M), lazo (L) o varita (W).", "info");
        return;
      }
      if (tool === "clone" && variant !== "pattern" && !cloneSrcRef.current) { // F4.2e: el patrón no necesita origen
        addToast("Alt+clic define el origen del tampón.", "info");
        return;
      }
      const layer = activeComposeLayer || createLayerNow();
      if (tool === "gradient") { fillSelection(layer.id); setComposeDirty(true); return; } // bote
      if (tool === "eraser" && variant === "magic") {
        buildMagicErase(displayPointToNorm(e), layer.id);
        setComposeDirty(true);
        return;
      }
      if (tool === "heal" && variant === "patch") {
        drag.current = { kind: "patch-drag", startX: e.clientX, startY: e.clientY, base: null };
        return;
      }
      if (tool === "move" && mode === "compose") {
        // F4.2d: auto-selección — la capa visible más alta con pintura bajo el puntero
        const p0 = displayPointToNorm(e);
        for (let i = composeLayers.length - 1; i >= 0; i--) {
          const l = composeLayers[i];
          const cv = l.visible ? layerCanvasesRef.current.get(l.id) : null;
          const c = cv?.getContext("2d");
          if (!cv || !c) continue;
          let alpha = 0;
          try { alpha = c.getImageData(clamp(Math.round(p0.x * cv.width), 0, cv.width - 1), clamp(Math.round(p0.y * cv.height), 0, cv.height - 1), 1, 1).data[3]; } catch { alpha = 0; }
          if (alpha > 8) { if (activeLayerId !== l.id) setActiveLayerId(l.id); break; }
        }
      }
      if (tool === "move" && activeComposeLayer) {
        drag.current = { kind: "layer-move", startX: e.clientX, startY: e.clientY, base: { ...activeComposeLayer.transform } };
        return;
      }
      drag.current = { kind: "layer-paint", startX: e.clientX, startY: e.clientY, base: { layerId: layer.id } };
      setComposeDirty(true);
      pushComposeHistory(); // F4.2d: un paso de undo por trazo
      if (tool === "blur" && variant === "sharpen") {
        // F4.2d: el enfocar REAL se aplica al soltar, sobre la región barrida
        sharpenStroke.current = { bbox: { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 }, before: cloneCanvas(layerCanvasesRef.current.get(layer.id) || ensureMasterCanvas(layer.id)), layerId: layer.id };
      }
      paintLayerAt(e, layer.id);
      return;
    }
    drag.current = { kind: "pan", startX: e.clientX, startY: e.clientY, base: { ...view } };
  };

  const stagePointerMove = (e: React.PointerEvent) => {
    // F4.2d: cursor circular del pincel (diámetro real) sobre el stage
    if (brushCursorRef.current) {
      const bc = brushCursorRef.current;
      const st = stageRef.current?.getBoundingClientRect();
      if (isPaintTool(tool) && st) {
        bc.style.display = "block";
        bc.style.left = `${e.clientX - st.left - paintSize / 2}px`;
        bc.style.top = `${e.clientY - st.top - paintSize / 2}px`;
        bc.style.width = `${paintSize}px`;
        bc.style.height = `${paintSize}px`;
      } else bc.style.display = "none";
    }
    const d = drag.current;
    if (!d || !imgDims) return;
    if (d.kind === "pan") {
      setView(v => ({ ...v, panX: d.base.panX + (e.clientX - d.startX), panY: d.base.panY + (e.clientY - d.startY) }));
    } else if (d.kind === "split") {
      const rect = stageRef.current?.getBoundingClientRect();
      if (rect) setSplit(clamp((e.clientX - rect.left) / rect.width, 0.02, 0.98));
    } else if (d.kind === "crop-move") {
      const dx = (e.clientX - d.startX) / Math.max(1, imgRect.width);
      const dy = (e.clientY - d.startY) / Math.max(1, imgRect.height);
      setCropDraft(r => ({
        ...r,
        x: clamp(d.base.x + dx, 0, 1 - r.w),
        y: clamp(d.base.y + dy, 0, 1 - r.h),
      }));
    } else if (d.kind === "crop-resize" && d.corner) {
      const dx = (e.clientX - d.startX) / Math.max(1, imgRect.width);
      const dy = (e.clientY - d.startY) / Math.max(1, imgRect.height);
      setCropDraft(() => resizeCrop(d.base, d.corner!, dx, dy, aspect));
    } else if (d.kind === "paint") {
      paintAt(e);
    } else if (d.kind === "layer-paint") {
      paintLayerAt(e, (d.base as { layerId: string }).layerId);
    } else if (d.kind === "mask-paint") {
      paintLayerAt(e, (d.base as { layerId: string }).layerId, { mask: true });
    } else if (d.kind === "tf-move" && activeLayerId) {
      const base = d.base as CompositionLayerTransform;
      const dx = (e.clientX - d.startX) / Math.max(1, imgRect.width);
      const dy = (e.clientY - d.startY) / Math.max(1, imgRect.height);
      setTfDraft(t => (t ? { ...t, x: clamp(base.x + dx, -2, 2), y: clamp(base.y + dy, -2, 2) } : t));
    } else if (d.kind === "tf-drag" && d.corner) {
      // F4.2d: manijas de la transformación libre (escala desde el centro · rotación)
      const rect = stageRef.current?.getBoundingClientRect();
      if (rect) {
        const cx = rect.left + imgRect.left + imgRect.width / 2;
        const cy = rect.top + imgRect.top + imgRect.height / 2;
        if (d.corner === "rot") {
          const a0 = Math.atan2(d.startY - cy, d.startX - cx);
          const a1 = Math.atan2(e.clientY - cy, e.clientX - cx);
          setTfDraft(t => (t ? { ...t, rotation: clamp((d.base as CompositionLayerTransform).rotation + ((a1 - a0) * 180) / Math.PI, -180, 180) } : t));
        } else {
          const r0 = Math.hypot(d.startX - cx, d.startY - cy);
          const r1 = Math.hypot(e.clientX - cx, e.clientY - cy);
          setTfDraft(t => (t ? { ...t, scale: clamp((d.base as CompositionLayerTransform).scale * (r1 / Math.max(4, r0)), 0.1, 8) } : t));
        }
      }
    } else if (d.kind === "sel-rect" && d.base) {
      const p0 = d.base as { x: number; y: number };
      const p1 = displayPointToNorm(e);
      setSelPreview({ kind: "rect", x: Math.min(p0.x, p1.x), y: Math.min(p0.y, p1.y), w: Math.abs(p1.x - p0.x), h: Math.abs(p1.y - p0.y) });
    } else if (d.kind === "sel-lasso") {
      const p1 = displayPointToNorm(e);
      setSelPreview(prev => (prev && prev.kind === "poly" ? { kind: "poly", pts: [...prev.pts, [p1.x, p1.y]] } : prev));
    } else if (d.kind === "sel-ellipse" && d.base) {
      const p0 = d.base as { x: number; y: number };
      const p1 = displayPointToNorm(e);
      setSelPreview({ kind: "ellipse", x: Math.min(p0.x, p1.x), y: Math.min(p0.y, p1.y), w: Math.abs(p1.x - p0.x), h: Math.abs(p1.y - p0.y) });
    } else if ((d.kind === "shape-rect" || d.kind === "shape-ellipse" || d.kind === "shape-poly" || d.kind === "shape-custom") && d.base) {
      const p0 = d.base as { x: number; y: number };
      const p1 = displayPointToNorm(e);
      setSelPreview({ kind: d.kind === "shape-rect" ? "rect" : "ellipse", x: Math.min(p0.x, p1.x), y: Math.min(p0.y, p1.y), w: Math.abs(p1.x - p0.x), h: Math.abs(p1.y - p0.y) });
    } else if ((d.kind === "shape-line" || d.kind === "gradient-drag") && d.base) {
      const p0 = d.base as { x: number; y: number };
      const p1 = displayPointToNorm(e);
      setSelPreview({ kind: "line", x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y });
    } else if (d.kind === "pen-free") {
      // F4.2e: pluma libre — acumula puntos con distancia mínima
      const p1 = displayPointToNorm(e);
      setPenPts(prev => {
        const last = prev[prev.length - 1];
        if (last && Math.hypot(p1.x - last[0], p1.y - last[1]) < 0.004) return prev;
        return [...prev, [p1.x, p1.y]];
      });
    } else if (d.kind === "qmask-paint") {
      qmaskPaintAt(displayPointToNorm(e), e.altKey);
    } else if (d.kind === "layer-move" && activeLayerId) {
      const base = d.base as CompositionLayerTransform;
      const dx = (e.clientX - d.startX) / Math.max(1, imgRect.width);
      const dy = (e.clientY - d.startY) / Math.max(1, imgRect.height);
      setComposeLayers(ls => ls.map(l => (l.id === activeLayerId
        ? { ...l, transform: { ...base, x: clamp(base.x + dx, -2, 2), y: clamp(base.y + dy, -2, 2) } }
        : l)));
      setComposeDirty(true);
    }
  };

  const stagePointerUp = (e?: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === "layer-paint") { lastPaintPt.current = null; applyUnsharpRegion(); setComposeTick(t => t + 1); }
    if (d?.kind === "mask-paint") lastPaintPt.current = null;
    if ((d?.kind === "sel-rect" || d?.kind === "sel-lasso" || d?.kind === "sel-ellipse") && selPreview) commitSelection(selModeRef.current);
    if (d?.kind === "patch-drag" && e) commitPatch(d.startX, d.startY, e);
    if (d && (d.kind === "shape-rect" || d.kind === "shape-ellipse" || d.kind === "shape-line" || d.kind === "shape-poly" || d.kind === "shape-custom") && e) commitShape(d, e);
    if (d?.kind === "pen-free") closePenPath(); // F4.2e: soltar cierra el trazado
    if (d?.kind === "qmask-paint") lastPaintPt.current = null;
    if (d?.kind === "gradient-drag" && e) commitGradient(d, e);
    if (d?.kind === "crop-move" || d?.kind === "crop-resize") {
      // commit del crop draft a la geometría
      const draft = cropDraft;
      past.current.push(JSON.stringify(recipe));
      future.current = [];
      setRecipe(r => {
        const next = JSON.parse(JSON.stringify(r)) as AnyRecipe;
        next.geometry.crop = displayRectToSourceRect(draft, next.geometry);
        return normalizeRecipe(next);
      });
      setHistVersion(v => v + 1);
    }
  };

  const displayPointToNorm = (e: React.PointerEvent): { x: number; y: number } => {
    const stage = stageRef.current?.getBoundingClientRect();
    if (!stage) return { x: 0, y: 0 };
    return {
      x: clamp((e.clientX - stage.left - imgRect.left) / Math.max(1, imgRect.width), 0, 1),
      y: clamp((e.clientY - stage.top - imgRect.top) / Math.max(1, imgRect.height), 0, 1),
    };
  };

  const paintAt = (e: React.PointerEvent) => {
    const cv = ensureBrushCanvas();
    const ctx = cv.getContext("2d")!;
    const p = displayPointToNorm(e);
    const x = p.x * cv.width;
    const y = (1 - p.y) * cv.height;
    const radius = 28;
    const grad = ctx.createRadialGradient(x, y, radius * 0.35, x, y, radius);
    grad.addColorStop(0, "rgba(255,255,255,0.9)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
    rendererRef.current?.setBrushMask(cv);
  };

  // ══ Fase 4: composición por capas ══

  /** Lienzo maestro offscreen de una capa (fuente de verdad para pintar,
   * decodificar y serializar). Resize preserva el contenido escalado. */
  const ensureMasterCanvas = (id: string): HTMLCanvasElement => {
    const w = Math.max(1, Math.min(2048, Math.round(outSize.w)));
    const h = Math.max(1, Math.min(2048, Math.round(outSize.h)));
    let cv = layerCanvasesRef.current.get(id);
    if (!cv) {
      cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      layerCanvasesRef.current.set(id, cv);
    } else if (cv.width !== w || cv.height !== h) {
      const next = document.createElement("canvas");
      next.width = w; next.height = h;
      next.getContext("2d")?.drawImage(cv, 0, 0, w, h);
      layerCanvasesRef.current.set(id, next);
    }
    return layerCanvasesRef.current.get(id)!;
  };

  /** Snapshot del revelado (sin split, sin zoom) a resolución de master, al
   * vuelo: render en vista identidad + drawImage en el MISMO tick — el buffer
   * WebGL sin preserveDrawingBuffer solo es fiable dentro de la misma tarea.
   * Lo consumen varita, cuentagotas, clonar, corrector y parche. */
  const ensureSnapshot = (): HTMLCanvasElement | null => {
    const renderer = rendererRef.current;
    const glCanvas = canvasRef.current;
    if (!renderer || !glCanvas || glError || !imgDims) return null;
    const w = Math.max(1, Math.min(2048, Math.round(outSize.w)));
    const h = Math.max(1, Math.min(2048, Math.round(outSize.h)));
    let cv = snapshotRef.current;
    if (!cv || cv.width !== w || cv.height !== h) {
      cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      snapshotRef.current = cv;
    }
    const ctx = cv.getContext("2d");
    if (!ctx) return null;
    renderer.update(recipe, { view: { zoom: 1, panX: 0, panY: 0 } });
    // la vista identidad encaja la foto en el canvas: recortamos ese sub-rect
    const fit = Math.min(glCanvas.width / outSize.w, glCanvas.height / outSize.h) || 1;
    const fw = Math.max(1, outSize.w * fit), fh = Math.max(1, outSize.h * fit);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(glCanvas, (glCanvas.width - fw) / 2, (glCanvas.height - fh) / 2, fw, fh, 0, 0, cv.width, cv.height);
    renderer.update(recipe, { view, split, original: showOriginal }); // restaura la vista real
    return cv;
  };

  /** Scratch a tamaño master: cada trazo se compone aquí y se vuelca al final. */
  const ensureScratch = (): HTMLCanvasElement => {
    const w = Math.max(1, Math.min(2048, Math.round(outSize.w)));
    const h = Math.max(1, Math.min(2048, Math.round(outSize.h)));
    let cv = scratchRef.current;
    if (!cv || cv.width !== w || cv.height !== h) {
      cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      scratchRef.current = cv;
    }
    return cv;
  };

  /** Máscara de selección (blanca sobre transparente) a tamaño master. */
  const ensureSelectionMask = (): HTMLCanvasElement => {
    const w = Math.max(1, Math.min(2048, Math.round(outSize.w)));
    const h = Math.max(1, Math.min(2048, Math.round(outSize.h)));
    let cv = selectionMaskRef.current;
    if (!cv || cv.width !== w || cv.height !== h) {
      cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      selectionMaskRef.current = cv;
    }
    return cv;
  };

  const clearSelection = () => {
    selectionMaskRef.current = null;
    setSelectionBBox(null);
    setSelPreview(null);
  };

  // ══ F4.2d: undo/redo de Componer, máscaras de capa, feather, unsharp ══

  const cloneCanvas = (src: HTMLCanvasElement): HTMLCanvasElement => {
    const cv = document.createElement("canvas");
    cv.width = src.width; cv.height = src.height;
    cv.getContext("2d")?.drawImage(src, 0, 0);
    return cv;
  };

  const snapCompose = (metaOnly = false): ComposeSnap => ({
    layers: JSON.parse(JSON.stringify(composeLayersRef.current)) as CompositionLayer[],
    activeId: activeLayerId,
    label: "",
    canvases: metaOnly ? [] : [...layerCanvasesRef.current].map(([id, cv]): [string, HTMLCanvasElement] => [id, cloneCanvas(cv)]),
    masks: metaOnly ? [] : [...layerMasksRef.current].map(([id, cv]): [string, HTMLCanvasElement] => [id, cloneCanvas(cv)]),
  });

  const restoreCompose = (s: ComposeSnap) => {
    if (s.canvases.length) layerCanvasesRef.current = new Map(s.canvases.filter(c => c[1]).map(c => [c[0], c[1]!]));
    if (s.masks.length) layerMasksRef.current = new Map(s.masks.filter(m => m[1]).map(m => [m[0], m[1]!]));
    setComposeLayers(JSON.parse(JSON.stringify(s.layers)) as CompositionLayer[]);
    setActiveLayerId(s.activeId);
    setComposeDirty(true);
    setComposeTick(t => t + 1);
  };

  // F4.2e: label opcional para el panel Historia (salta a pasos concretos)
  const pushComposeHistory = (metaOnly = false, label = "Paso") => {
    const snap = snapCompose(metaOnly);
    snap.label = label;
    composePast.current.push(snap);
    if (composePast.current.length > 12) composePast.current.shift();
    composeFuture.current = [];
    setHistTick(t => t + 1);
  };

  /** Para sliders/checkboxes: un solo paso de historial por ráfaga de cambios. */
  const pushComposeHistoryMeta = () => {
    const now = Date.now();
    if (now - lastMetaPush.current > 600) pushComposeHistory(true);
    lastMetaPush.current = now;
  };

  const composeUndo = () => {
    const prev = composePast.current.pop();
    if (!prev) { addToast("Nada que deshacer en la composición.", "info"); return; }
    composeFuture.current.push(snapCompose(false));
    restoreCompose(prev);
    setHistTick(t => t + 1);
  };

  const composeRedo = () => {
    const next = composeFuture.current.pop();
    if (!next) { addToast("Nada que rehacer.", "info"); return; }
    composePast.current.push(snapCompose(false));
    restoreCompose(next);
    setHistTick(t => t + 1);
  };

  /** F4.2e: salto del panel Historia — deshace en cadena hasta el paso elegido. */
  const jumpComposeHistory = (targetIdx: number) => {
    let jumps = composePast.current.length - 1 - targetIdx;
    while (jumps-- > 0) composeUndo();
  };

  /** F4.2d: transformación libre (Ctrl+T) — manijas en el canvas, Enter aplica. */
  const enterTfDraft = () => {
    if (!activeComposeLayer) { addToast("Selecciona una capa para transformar.", "info"); return; }
    setTfDraft({ ...activeComposeLayer.transform });
    addToast("Transformación libre: arrastra el contenido (mover), las esquinas (escalar) o la manija superior (rotar). Enter aplica · Esc cancela.", "info");
  };

  const commitTfDraft = () => {
    const t = tfDraft;
    setTfDraft(null);
    if (!t || !activeLayerId) return;
    pushComposeHistory(true);
    setComposeLayers(ls => ls.map(l => (l.id === activeLayerId
      ? { ...l, transform: { x: clamp(t.x, -2, 2), y: clamp(t.y, -2, 2), scale: clamp(t.scale, 0.1, 8), rotation: clamp(t.rotation, -180, 180) } }
      : l)));
    setComposeDirty(true);
    addToast("Transformación aplicada a la capa.", "info");
  };

  // ══ F4.2e: operaciones de capa, portapapeles, filtros y máscara rápida ══

  /** Duplicar capa (Ctrl+J): clona definición + master + máscara con un
   * offset mínimo para que el duplicado se perciba. */
  const composeDuplicateLayer = (id: string) => {
    const src = composeLayersRef.current.find(l => l.id === id);
    if (!src) return;
    if (composeLayersRef.current.length >= MAX_COMPOSITION_LAYERS) { addToast(`Máximo ${MAX_COMPOSITION_LAYERS} capas.`, "info"); return; }
    pushComposeHistory(false, `Duplicar «${src.name}»`);
    const copy: CompositionLayer = {
      ...(JSON.parse(JSON.stringify(src)) as CompositionLayer),
      id: `capa_${Date.now().toString(36)}_dup`,
      name: `${src.name} copia`,
      transform: { ...src.transform, x: clamp(src.transform.x + 0.002, -2, 2), y: clamp(src.transform.y + 0.002, -2, 2) },
    };
    const master = layerCanvasesRef.current.get(id);
    if (master) layerCanvasesRef.current.set(copy.id, cloneCanvas(master));
    const mk = layerMasksRef.current.get(id);
    if (mk) layerMasksRef.current.set(copy.id, cloneCanvas(mk));
    setComposeLayers(ls => [...ls, copy]);
    setActiveLayerId(copy.id);
    setComposeDirty(true);
    setComposeTick(t => t + 1);
    addToast(`Capa duplicada: «${copy.name}».`, "info");
  };

  /** Fusionar hacia abajo (Ctrl+E): rasteriza la capa sobre un scratch
   * (transform + ajustes + máscara), la compone en la de abajo con su blend
   * y opacidad, y elimina la de arriba. */
  const composeMergeDown = (id: string) => {
    const ls = composeLayersRef.current;
    const idx = ls.findIndex(l => l.id === id);
    if (idx <= 0) { addToast("No hay capa debajo hacia la que fusionar.", "info"); return; }
    const top = ls[idx];
    const below = ls[idx - 1];
    pushComposeHistory(false, `Fusionar «${top.name}»`);
    const belowMaster = layerCanvasesRef.current.get(below.id) || ensureMasterCanvas(below.id);
    const topMaster = layerCanvasesRef.current.get(top.id) || ensureMasterCanvas(top.id);
    const scratch = ensureScratch();
    const sctx = scratch.getContext("2d");
    if (!sctx) return;
    sctx.clearRect(0, 0, scratch.width, scratch.height);
    sctx.save();
    sctx.translate(scratch.width / 2 + top.transform.x * scratch.width, scratch.height / 2 + top.transform.y * scratch.height);
    sctx.rotate((top.transform.rotation * Math.PI) / 180);
    sctx.scale(top.transform.scale, top.transform.scale);
    if (top.adjust) sctx.filter = adjustFilterOf(top.adjust);
    sctx.drawImage(topMaster, -scratch.width / 2, -scratch.height / 2, scratch.width, scratch.height);
    sctx.filter = "none";
    const mk = layerMasksRef.current.get(top.id);
    if (mk) {
      sctx.globalCompositeOperation = "destination-in";
      sctx.drawImage(mk, -scratch.width / 2, -scratch.height / 2, scratch.width, scratch.height);
      sctx.globalCompositeOperation = "source-over";
    }
    sctx.restore();
    const mctx = belowMaster.getContext("2d");
    if (mctx) {
      mctx.save();
      mctx.globalCompositeOperation = blendToCanvasOp(top.blend);
      mctx.globalAlpha = clamp(top.opacity, 0, 1);
      mctx.drawImage(scratch, 0, 0);
      mctx.restore();
    }
    layerCanvasesRef.current.delete(top.id);
    mirrorCanvasesRef.current.delete(top.id);
    layerMasksRef.current.delete(top.id);
    setComposeLayers(arr => arr.filter(l => l.id !== top.id));
    setActiveLayerId(a => (a === top.id ? below.id : a));
    setComposeDirty(true);
    setComposeTick(t => t + 1);
    addToast(`«${top.name}» fusionada hacia abajo.`, "info");
  };

  /** Aplanar imagen (Ctrl+Shift+E): todas las capas visibles se componen en
   * orden sobre un único bitmap que sustituye al stack como capa "Aplanada". */
  const composeFlattenLayers = () => {
    const ls = composeLayersRef.current;
    if (ls.length < 2) { addToast("Solo hay una capa — nada que aplanar.", "info"); return; }
    const visible = ls.filter(l => l.visible);
    if (!visible.length) { addToast("Todas las capas están ocultas.", "info"); return; }
    pushComposeHistory(false, "Aplanar imagen");
    const base = document.createElement("canvas");
    base.width = Math.max(1, Math.min(2048, Math.round(outSize.w)));
    base.height = Math.max(1, Math.min(2048, Math.round(outSize.h)));
    const bctx = base.getContext("2d");
    const scratch = ensureScratch();
    const sctx = scratch.getContext("2d");
    if (!bctx || !sctx) return;
    for (const layer of visible) {
      const src = layerCanvasesRef.current.get(layer.id) || ensureMasterCanvas(layer.id);
      sctx.clearRect(0, 0, scratch.width, scratch.height);
      sctx.save();
      sctx.translate(scratch.width / 2 + layer.transform.x * scratch.width, scratch.height / 2 + layer.transform.y * scratch.height);
      sctx.rotate((layer.transform.rotation * Math.PI) / 180);
      sctx.scale(layer.transform.scale, layer.transform.scale);
      if (layer.adjust) sctx.filter = adjustFilterOf(layer.adjust);
      sctx.drawImage(src, -scratch.width / 2, -scratch.height / 2, scratch.width, scratch.height);
      sctx.filter = "none";
      const mk = layerMasksRef.current.get(layer.id);
      if (mk) {
        sctx.globalCompositeOperation = "destination-in";
        sctx.drawImage(mk, -scratch.width / 2, -scratch.height / 2, scratch.width, scratch.height);
        sctx.globalCompositeOperation = "source-over";
      }
      sctx.restore();
      bctx.save();
      bctx.globalCompositeOperation = blendToCanvasOp(layer.blend);
      bctx.globalAlpha = clamp(layer.opacity, 0, 1);
      bctx.drawImage(scratch, 0, 0);
      bctx.restore();
    }
    const flat = createPaintLayer(0);
    flat.name = "Aplanada";
    for (const l of ls) {
      layerCanvasesRef.current.delete(l.id);
      mirrorCanvasesRef.current.delete(l.id);
      layerMasksRef.current.delete(l.id);
    }
    layerCanvasesRef.current.set(flat.id, base);
    setComposeLayers([flat]);
    setActiveLayerId(flat.id);
    setComposeDirty(true);
    setComposeTick(t => t + 1);
    addToast(`Imagen aplanada a 1 capa (${visible.length} fusionadas).`, "info");
  };

  /** Portapapeles interno (Ctrl+C/Ctrl+V): copia la capa activa recortada por
   * la selección (si la hay); pega SIEMPRE como capa nueva con offset leve. */
  const copySelectionToClipboard = () => {
    const layer = activeComposeLayer;
    const master = layer ? layerCanvasesRef.current.get(layer.id) : null;
    if (!layer || !master) { addToast("Selecciona una capa con contenido (modo Componer) para copiar.", "info"); return; }
    const tmp = document.createElement("canvas");
    tmp.width = master.width; tmp.height = master.height;
    const tctx = tmp.getContext("2d");
    if (!tctx) return;
    tctx.drawImage(master, 0, 0);
    if (selectionMaskRef.current) {
      tctx.globalCompositeOperation = "destination-in";
      tctx.drawImage(selectionMaskRef.current, 0, 0);
      tctx.globalCompositeOperation = "source-over";
    }
    clipboardRef.current = tmp;
    addToast(selectionMaskRef.current ? "Selección copiada — Ctrl+V la pega como capa nueva."
      : "Capa copiada — Ctrl+V la pega como capa nueva.", "info");
  };

  const pasteClipboardAsLayer = () => {
    const cv = clipboardRef.current;
    if (!cv) { addToast("Portapapeles vacío — copia con Ctrl+C primero.", "info"); return; }
    if (composeLayersRef.current.length >= MAX_COMPOSITION_LAYERS) { addToast(`Máximo ${MAX_COMPOSITION_LAYERS} capas.`, "info"); return; }
    pushComposeHistory(false, "Pegar");
    const layer = createPaintLayer(composeLayersRef.current.length);
    layer.name = "Pegada";
    layer.transform = { ...layer.transform, x: 0.01, y: 0.01 };
    setComposeLayers(ls => [...ls, layer]);
    setActiveLayerId(layer.id);
    const master = ensureMasterCanvas(layer.id);
    master.getContext("2d")?.drawImage(cv, 0, 0);
    setComposeDirty(true);
    setComposeTick(t => t + 1);
    addToast("Contenido pegado como capa nueva.", "info");
  };

  /** Guardar/cargar selección (slot único estilo Photoshop). */
  const saveSelectionSlot = () => {
    const mask = selectionMaskRef.current;
    if (!mask) { addToast("No hay selección activa que guardar.", "info"); return; }
    savedSelectionRef.current = { mask: cloneCanvas(mask), bbox: selectionBBox ? { ...selectionBBox } : { x: 0, y: 0, w: 1, h: 1 } };
    setHasSavedSel(true);
    addToast("Selección guardada — «Cargar sel.» la restaura en cualquier momento.", "info");
  };

  const loadSelectionSlot = () => {
    const saved = savedSelectionRef.current;
    if (!saved) { addToast("Todavía no has guardado ninguna selección.", "info"); return; }
    selectionMaskRef.current = cloneCanvas(saved.mask);
    setSelectionBBox({ ...saved.bbox });
    addToast("Selección cargada.", "info");
  };

  /** Menú Filtro sobre la capa activa: gaussiano, ruido, mosaico, paso alto
   * y nubes. Con selección activa, el efecto queda recortado a ella. */
  const applyLayerFilter = (kind: "gauss" | "noise" | "mosaic" | "highpass" | "clouds") => {
    const layer = activeComposeLayer;
    if (!layer) { addToast("Selecciona una capa (modo Componer) para aplicar el filtro.", "info"); return; }
    pushComposeHistory(false, `Filtro: ${kind}`);
    const master = layerCanvasesRef.current.get(layer.id) || ensureMasterCanvas(layer.id);
    const ctx = master.getContext("2d");
    const scratch = ensureScratch();
    const sctx = scratch.getContext("2d");
    if (!ctx || !sctx) return;
    const k = master.width / Math.max(1, imgRect.width);
    sctx.clearRect(0, 0, scratch.width, scratch.height);
    sctx.drawImage(master, 0, 0);
    if (kind === "gauss") {
      const blurPx = Math.max(1, (paintSize / 4) * k);
      const tmp = cloneCanvas(scratch);
      sctx.clearRect(0, 0, scratch.width, scratch.height);
      sctx.filter = `blur(${blurPx.toFixed(2)}px)`;
      sctx.drawImage(tmp, 0, 0);
      sctx.filter = "none";
    } else if (kind === "noise") {
      let px: Uint8ClampedArray;
      try { px = sctx.getImageData(0, 0, scratch.width, scratch.height).data; } catch { return; }
      const amount = Math.max(4, paintSize) * 1.6;
      const out = sctx.createImageData(scratch.width, scratch.height);
      for (let i = 0; i < px.length; i += 4) {
        const d = (Math.random() * 2 - 1) * amount;
        out.data[i] = clampByte(px[i] + d);
        out.data[i + 1] = clampByte(px[i + 1] + d);
        out.data[i + 2] = clampByte(px[i + 2] + d);
        out.data[i + 3] = px[i + 3];
      }
      sctx.putImageData(out, 0, 0);
    } else if (kind === "mosaic") {
      const block = Math.max(3, Math.round((paintSize / 2.5) * k));
      const sw = Math.max(1, Math.floor(scratch.width / block));
      const sh = Math.max(1, Math.floor(scratch.height / block));
      const small = document.createElement("canvas");
      small.width = sw; small.height = sh;
      small.getContext("2d")?.drawImage(scratch, 0, 0, sw, sh);
      sctx.clearRect(0, 0, scratch.width, scratch.height);
      sctx.imageSmoothingEnabled = false;
      sctx.drawImage(small, 0, 0, sw, sh, 0, 0, scratch.width, scratch.height);
      sctx.imageSmoothingEnabled = true;
    } else if (kind === "highpass") {
      const tmp = cloneCanvas(scratch);
      const blurred = document.createElement("canvas");
      blurred.width = scratch.width; blurred.height = scratch.height;
      const bctx = blurred.getContext("2d");
      if (!bctx) return;
      bctx.filter = `blur(${Math.max(1.5, (paintSize / 8) * k).toFixed(2)}px)`;
      bctx.drawImage(tmp, 0, 0);
      bctx.filter = "none";
      const base = sctx.getImageData(0, 0, scratch.width, scratch.height);
      const soft = bctx.getImageData(0, 0, scratch.width, scratch.height);
      const out = sctx.createImageData(scratch.width, scratch.height);
      for (let i = 0; i < base.data.length; i += 4) {
        out.data[i] = clampByte(base.data[i] - soft.data[i] + 128);
        out.data[i + 1] = clampByte(base.data[i + 1] - soft.data[i + 1] + 128);
        out.data[i + 2] = clampByte(base.data[i + 2] - soft.data[i + 2] + 128);
        out.data[i + 3] = base.data[i + 3];
      }
      sctx.putImageData(out, 0, 0);
    } else { // nubes
      for (let i = 0; i < 26; i++) {
        const cx = Math.random() * scratch.width, cy = Math.random() * scratch.height;
        const r = (0.08 + Math.random() * 0.22) * scratch.width;
        const g = sctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        const tone = Math.round(96 + Math.random() * 128);
        g.addColorStop(0, `rgba(${tone},${tone},${tone},0.5)`);
        g.addColorStop(1, "rgba(0,0,0,0)");
        sctx.fillStyle = g;
        sctx.fillRect(0, 0, scratch.width, scratch.height);
      }
    }
    // recorta a la selección activa y sustituye el master
    if (selectionMaskRef.current) {
      sctx.globalCompositeOperation = "destination-in";
      sctx.drawImage(selectionMaskRef.current, 0, 0);
      sctx.globalCompositeOperation = "source-over";
      ctx.drawImage(scratch, 0, 0);
    } else {
      ctx.clearRect(0, 0, master.width, master.height);
      ctx.drawImage(scratch, 0, 0);
    }
    setComposeDirty(true);
    setComposeTick(t => t + 1);
    addToast(`Filtro «${kind}» aplicado${selectionMaskRef.current ? " dentro de la selección" : ""}.`, "info");
  };

  /** Máscara rápida (Q): pinta (rojo en pantalla) lo que NO queda seleccionado;
   * al salir con Q, lo pintado se convierte en la selección. Alt borra. */
  const ensureQmaskCanvas = (): HTMLCanvasElement => {
    const w = Math.max(1, Math.min(2048, Math.round(outSize.w)));
    const h = Math.max(1, Math.min(2048, Math.round(outSize.h)));
    let cv = qmaskCanvasRef.current;
    if (!cv || cv.width !== w || cv.height !== h) {
      cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      qmaskCanvasRef.current = cv;
    }
    return cv;
  };

  const qmaskPaintAt = (p: { x: number; y: number }, erase: boolean) => {
    const cv = ensureQmaskCanvas();
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const kk = cv.width / Math.max(1, imgRect.width);
    const radius = Math.max(2, (paintSize / 2) * kk);
    const x = p.x * cv.width, y = p.y * cv.height;
    ctx.globalCompositeOperation = erase ? "destination-out" : "source-over";
    const grad = ctx.createRadialGradient(x, y, radius * 0.35, x, y, radius);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    setComposeTick(t => t + 1); // refresca el overlay rojo
  };

  const toggleQuickMask = () => {
    if (qmask) {
      const cv = qmaskCanvasRef.current;
      setQmask(false);
      if (cv) {
        // ¿se pintó algo? bbox barato sobre una copia a media resolución
        const W = Math.max(1, Math.min(256, cv.width));
        const H = Math.max(1, Math.round(cv.height * (W / cv.width)));
        const small = document.createElement("canvas");
        small.width = W; small.height = H;
        const sctx = small.getContext("2d");
        if (!sctx) return;
        sctx.drawImage(cv, 0, 0, W, H);
        let px: Uint8ClampedArray;
        try { px = sctx.getImageData(0, 0, W, H).data; } catch { return; }
        let minX = W, minY = H, maxX = -1, maxY = -1;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            if (px[(y * W + x) * 4 + 3] > 8) {
              if (x < minX) minX = x; if (x > maxX) maxX = x;
              if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
          }
        }
        qmaskCanvasRef.current = null;
        if (maxX < 0) { addToast("Máscara rápida vacía — no se creó selección.", "info"); return; }
        selectionMaskRef.current = cv;
        setSelectionBBox({ x: minX / W, y: minY / H, w: (maxX - minX + 1) / W, h: (maxY - minY + 1) / H });
        setSelPreview(null);
        addToast("Máscara rápida convertida en selección.", "info");
      }
    } else {
      const cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.min(2048, Math.round(outSize.w)));
      cv.height = Math.max(1, Math.min(2048, Math.round(outSize.h)));
      if (selectionMaskRef.current) cv.getContext("2d")?.drawImage(selectionMaskRef.current, 0, 0); // la selección entra editable
      qmaskCanvasRef.current = cv;
      setQmask(true);
      addToast("Máscara rápida: pinta para añadir · Alt borra · Q confirma la selección.", "info");
    }
  };

  /** Tesela procedural del tampón de patrón (cacheada por tipo+tamaño+color). */
  const getPatternTile = (masterWidth: number): HTMLCanvasElement => {
    const kk = masterWidth / Math.max(1, imgRect.width);
    const size = Math.max(6, Math.round(patternTile * kk));
    const key = `${patternKind}:${size}:${paintColor}`;
    if (patternTileRef.current?.key === key) return patternTileRef.current.cv;
    const cv = document.createElement("canvas");
    cv.width = size; cv.height = size;
    const c = cv.getContext("2d");
    if (c) {
      const rgb = hexToRgb(paintColor);
      if (patternKind === "cuadros") {
        c.fillStyle = `rgba(${rgb},0.9)`; c.fillRect(0, 0, size, size);
        c.fillStyle = `rgba(${rgb},0.35)`; c.fillRect(0, 0, size / 2, size / 2); c.fillRect(size / 2, size / 2, size / 2, size / 2);
      } else if (patternKind === "puntos") {
        c.fillStyle = `rgba(${rgb},1)`;
        const r = Math.max(1, size * 0.12);
        for (const [px, py] of [[0.25, 0.25], [0.75, 0.75]] as const) {
          c.beginPath(); c.arc(size * px, size * py, r, 0, Math.PI * 2); c.fill();
        }
      } else if (patternKind === "diagonal") {
        c.strokeStyle = `rgba(${rgb},1)`;
        c.lineWidth = Math.max(1, size * 0.1);
        c.beginPath();
        c.moveTo(-size * 0.25, size * 0.75); c.lineTo(size * 0.75, -size * 0.25);
        c.moveTo(size * 0.25, size * 1.25); c.lineTo(size * 1.25, size * 0.25);
        c.stroke();
      } else { // ruido
        const img = c.createImageData(size, size);
        const [r0, g0, b0] = rgb.split(",").map(Number);
        for (let i = 0; i < img.data.length; i += 4) {
          img.data[i] = r0; img.data[i + 1] = g0; img.data[i + 2] = b0;
          img.data[i + 3] = Math.random() > 0.5 ? 255 : 0;
        }
        c.putImageData(img, 0, 0);
      }
    }
    patternTileRef.current = { key, cv };
    return cv;
  };

  /** Selección rápida REAL (SAM server-side): POST /api/segment/click → poll
   * /api/segment/jobs/:id → la maskUrl llega a tamaño imagen y se vuelve
   * selección. En local el worker no corre: timeout honesto que sugiere la
   * varita clásica. (Sin feather: el contorno del modelo ya es suave.) */
  const samQuickSelect = async (p: { x: number; y: number }, selMode: "new" | "add" | "sub") => {
    if (!active || samBusy) return;
    setSamBusy(true);
    try {
      const res = await apiFetch<any>("/api/segment/click", {
        method: "POST",
        body: JSON.stringify({
          url: active.src,
          workspaceId,
          points: [selMode === "sub" ? { x: p.x, y: p.y, neg: true } : { x: p.x, y: p.y }],
        }),
      });
      const jobId: string | undefined = res?.jobId;
      if (!res?.success || !jobId) throw new Error(res?.error || "El servidor no aceptó la segmentación.");
      let result: any = null;
      for (let i = 0; i < 16; i++) {
        await new Promise(r => setTimeout(r, 1500));
        const job = await apiFetch<any>(`/api/segment/jobs/${encodeURIComponent(jobId)}`);
        if (job?.status === "done") { result = job.result || {}; break; }
        if (job?.status === "error") throw new Error(job?.error || "La segmentación falló en el servidor.");
      }
      const maskUrl: string | undefined = result?.maskUrl;
      if (!maskUrl) throw new Error("Segmentación sigue en cola (el worker no corre en local) — usa la varita mágica (W).");
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("No se pudo leer la máscara del servidor."));
        img.src = maskUrl;
      });
      const mask = selMode !== "new" && selectionMaskRef.current ? selectionMaskRef.current : ensureSelectionMask();
      const prevBBox = selMode !== "new" ? selectionBBox : null;
      const mctx = mask.getContext("2d");
      if (!mctx) return;
      if (selMode === "new") mctx.clearRect(0, 0, mask.width, mask.height);
      if (selMode === "sub") mctx.globalCompositeOperation = "destination-out";
      mctx.drawImage(img, 0, 0, mask.width, mask.height);
      mctx.globalCompositeOperation = "source-over";
      setSelectionBBox(selMode === "sub" ? (prevBBox || { x: 0, y: 0, w: 1, h: 1 }) : { x: 0, y: 0, w: 1, h: 1 });
      setSelPreview(null);
      addToast(selMode === "add" ? "Selección rápida (+): objeto añadido."
        : selMode === "sub" ? "Selección rápida (−): zona restada."
        : "Selección rápida: objeto detectado por SAM.", "info");
    } catch (e: any) {
      addToast(e?.message || "Selección rápida no disponible ahora.", "error");
    } finally {
      setSamBusy(false);
    }
  };

  /** Máscara de capa (viva en la sesión, opaca = visible): pintar en ella
   * OCULTA (destination-out) y con Alt REVELA (source-over blanco). */
  const ensureLayerMask = (layerId: string): HTMLCanvasElement => {
    let cv = layerMasksRef.current.get(layerId);
    if (!cv) {
      cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.min(2048, Math.round(outSize.w)));
      cv.height = Math.max(1, Math.min(2048, Math.round(outSize.h)));
      const c = cv.getContext("2d");
      if (c) { c.fillStyle = "#ffffff"; c.fillRect(0, 0, cv.width, cv.height); }
      layerMasksRef.current.set(layerId, cv);
    }
    return cv;
  };

  /** Invierte la selección activa (Ctrl+Shift+I). */
  const invertSelection = () => {
    const mask = selectionMaskRef.current;
    if (!mask) { addToast("No hay selección que invertir.", "info"); return; }
    const tmp = document.createElement("canvas");
    tmp.width = mask.width; tmp.height = mask.height;
    const t = tmp.getContext("2d");
    const m = mask.getContext("2d");
    if (!t || !m) return;
    t.fillStyle = "#ffffff"; t.fillRect(0, 0, tmp.width, tmp.height);
    t.globalCompositeOperation = "destination-out";
    t.drawImage(mask, 0, 0);
    t.globalCompositeOperation = "source-over";
    m.clearRect(0, 0, mask.width, mask.height);
    m.drawImage(tmp, 0, 0);
    setSelectionBBox({ x: 0, y: 0, w: 1, h: 1 });
    addToast("Selección invertida — lo que estaba fuera ahora está dentro.", "info");
  };

  /** Feather al commit: difumina el borde de la máscara (blur = px·escala). */
  const applyFeatherToMask = () => {
    const mask = selectionMaskRef.current;
    if (!mask || selFeather <= 0) return;
    const blurPx = Math.max(0.5, selFeather * (mask.width / Math.max(1, imgRect.width)));
    const tmp = document.createElement("canvas");
    tmp.width = mask.width; tmp.height = mask.height;
    const t = tmp.getContext("2d");
    const m = mask.getContext("2d");
    if (!t || !m) return;
    t.filter = `blur(${blurPx.toFixed(2)}px)`;
    t.drawImage(mask, 0, 0);
    t.filter = "none";
    m.clearRect(0, 0, mask.width, mask.height);
    m.drawImage(tmp, 0, 0);
  };

  /** (Re)rasteriza la definición viva de una capa de texto en su master. */
  const rasterTextLayer = (layer: CompositionLayer) => {
    if (!layer.text) return;
    const master = ensureMasterCanvas(layer.id);
    const ctx = master.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, master.width, master.height);
    const px = Math.max(6, layer.text.size * (master.width / Math.max(1, imgRect.width)));
    ctx.fillStyle = layer.text.color;
    ctx.textBaseline = "alphabetic";
    ctx.font = `600 ${px}px ${layer.text.font}`;
    const x = layer.text.x * master.width;
    const y = layer.text.y * master.height;
    if (layer.text.vertical) {
      // F4.2e: texto vertical — cada línea rotada 90°, columnas de izquierda a derecha
      layer.text.value.split("\n").forEach((line, i) => {
        ctx.save();
        ctx.translate(x + i * px * 1.25, y);
        ctx.rotate(Math.PI / 2);
        ctx.fillText(line, 0, 0);
        ctx.restore();
      });
    } else {
      layer.text.value.split("\n").forEach((line, i) => ctx.fillText(line, x, y + i * px * 1.25));
    }
  };

  /** Enfocar REAL (máscara de desenfoque): al soltar el trazo aplica
   * out = base + 0.9·(base − gaussiana(base)) sobre la región barrida,
   * usando el estado PREVIO al trazo como base (sin doble aplicación). */
  const applyUnsharpRegion = () => {
    const s = sharpenStroke.current;
    sharpenStroke.current = null;
    if (!s) return;
    const master = layerCanvasesRef.current.get(s.layerId);
    const ctx = master?.getContext("2d");
    if (!master || !ctx) return;
    const pad = 4;
    const x0 = clamp(Math.round(s.bbox.x0) - pad, 0, master.width - 1);
    const y0 = clamp(Math.round(s.bbox.y0) - pad, 0, master.height - 1);
    const w = clamp(Math.round(s.bbox.x1) + pad - x0, 1, master.width - x0);
    const h = clamp(Math.round(s.bbox.y1) + pad - y0, 1, master.height - y0);
    if (w < 2 || h < 2) return;
    const blurred = document.createElement("canvas");
    blurred.width = w; blurred.height = h;
    const bctx = blurred.getContext("2d");
    if (!bctx) return;
    bctx.filter = "blur(2px)";
    bctx.drawImage(s.before, x0, y0, w, h, 0, 0, w, h);
    bctx.filter = "none";
    const base = ctx.getImageData(x0, y0, w, h);
    const soft = bctx.getImageData(0, 0, w, h);
    const out = ctx.createImageData(w, h);
    const amount = 0.9;
    for (let i = 0; i < base.data.length; i += 4) {
      out.data[i] = clampByte(base.data[i] + amount * (base.data[i] - soft.data[i]));
      out.data[i + 1] = clampByte(base.data[i + 1] + amount * (base.data[i + 1] - soft.data[i + 1]));
      out.data[i + 2] = clampByte(base.data[i + 2] + amount * (base.data[i + 2] - soft.data[i + 2]));
      out.data[i + 3] = base.data[i + 3];
    }
    ctx.putImageData(out, x0, y0);
  };

  /** Motor de trazos estilo Photoshop (por GRUPO + variante): cada movimiento
   * estampa en un scratch y lo vuelca al MAESTRO de la capa; con selección
   * activa, el trazo queda recortado a ella. Modos de fuente:
   *   ink     — pincel/lápiz/goma/exponer/quemar (tinta plana, lápiz duro)
   *   clone   — tampón desde el snapshot con offset Alt+clic alineado
   *   heal    — corrector puntual/pincel (entorno desplazado + difuminado)
   *   history — pincel de historial: reestampa el revelado base misma posición
   *   fx      — desenfocar/enfocar/dedo/esponja/ojos rojos (filtro sobre capa) */
  const paintLayerAt = (e: React.PointerEvent, layerId: string, opts?: { mask?: boolean }) => {
    const onMask = !!opts?.mask; // F4.2d: pintar la MÁSCARA de la capa en vez de la capa
    const master = onMask ? ensureLayerMask(layerId) : (layerCanvasesRef.current.get(layerId) || ensureMasterCanvas(layerId));
    const ctx = master.getContext("2d");
    const stage = stageRef.current?.getBoundingClientRect();
    if (!ctx || !stage) return;
    // normalizado 0..1 dentro del rect de imagen → px del lienzo maestro
    const nx = clamp((e.clientX - stage.left - imgRect.left) / Math.max(1, imgRect.width), 0, 1);
    const ny = clamp((e.clientY - stage.top - imgRect.top) / Math.max(1, imgRect.height), 0, 1);
    // Suavizar: el trazo persigue al puntero en vez de clavarse a él
    let x = nx * master.width, y = ny * master.height;
    if (paintSmooth > 0 && lastPaintPt.current && tool !== "clone") {
      const k = 1 - (paintSmooth / 100) * 0.85;
      x = lastPaintPt.current.x + (x - lastPaintPt.current.x) * k;
      y = lastPaintPt.current.y + (y - lastPaintPt.current.y) * k;
    }
    // el tamaño del trazo es en px de PANTALLA: se escala al lienzo maestro
    const screenScale = master.width / Math.max(1, imgRect.width);
    const radius = Math.max(1, (paintSize / 2) * screenScale);
    // F4.2d: presión de tableta/lápiz óptico modula el flujo del trazo
    const pressureK = e.pointerType === "pen" && e.pressure > 0 ? 0.35 + 0.65 * e.pressure : 1;
    const v = toolVariant;
    const fxVariant: string | null = onMask ? null
      : tool === "blur" ? (v === "sharpen" || v === "smudge" ? v : "blur")
      : tool === "dodge" && v === "sponge" ? "sponge"
      : tool === "heal" && v === "redeye" ? "redeye" : null;
    const srcMode: "ink" | "clone" | "heal" | "history" | "fx" = onMask ? "ink"
      : tool === "clone" ? "clone"
      : tool === "heal" && (v === "spot" || v === "heal") ? "heal"
      : tool === "history" ? "history"
      : fxVariant ? "fx" : "ink";
    // F4.2e: el tampón de patrón no consume el snapshot del revelado
    const isPattern = tool === "clone" && v === "pattern" && !onMask;
    const snap = isPattern ? null : ensureSnapshot();
    if ((srcMode === "clone" || srcMode === "heal" || srcMode === "history") && !isPattern && !snap) {
      addToast("El revelado todavía no está listo.", "info"); return;
    }
    const scratch = ensureScratch();
    const sctx = scratch.getContext("2d");
    if (!sctx) return;
    sctx.clearRect(0, 0, scratch.width, scratch.height);
    // offset del contenido: clonar usa el origen (Alt+clic, alineado); el
    // corrector v1 remuestrea el entorno en diagonal; el dedo arrastra desde detrás
    let offX = 0, offY = 0;
    if (srcMode === "clone" && cloneSrcRef.current) {
      if (!cloneOffsetRef.current) {
        cloneOffsetRef.current = {
          x: cloneSrcRef.current.x * master.width - x,
          y: cloneSrcRef.current.y * master.height - y,
        };
      }
      offX = cloneOffsetRef.current.x; offY = cloneOffsetRef.current.y;
    } else if (srcMode === "heal") {
      offX = radius * 1.6; offY = -radius * 1.6;
    } else if (fxVariant === "smudge" && lastPaintPt.current) {
      offX = lastPaintPt.current.x - x; offY = lastPaintPt.current.y - y;
    }
    const dist = lastPaintPt.current ? Math.hypot(x - lastPaintPt.current.x, y - lastPaintPt.current.y) : 0;
    const steps = Math.max(1, Math.ceil(dist / Math.max(1, radius * 0.35)));
    // F4.2e: tampón de PATRÓN — tesela procedural estampada por los puntos del
    // trazo (no necesita origen Alt); sale temprano del motor de fuentes
    if (isPattern) {
      const pat = sctx.createPattern(getPatternTile(master.width), "repeat");
      for (let i = 1; i <= steps; i++) {
        const t = steps === 1 ? 1 : i / steps;
        const cx = lastPaintPt.current ? lastPaintPt.current.x + (x - lastPaintPt.current.x) * t : x;
        const cy = lastPaintPt.current ? lastPaintPt.current.y + (y - lastPaintPt.current.y) * t : y;
        const pad = radius + 2;
        sctx.save();
        sctx.beginPath(); sctx.arc(cx, cy, radius, 0, Math.PI * 2); sctx.clip();
        if (pat) { sctx.fillStyle = pat; sctx.fillRect(cx - pad, cy - pad, pad * 2, pad * 2); }
        sctx.restore();
      }
      if (selectionMaskRef.current) {
        sctx.globalCompositeOperation = "destination-in";
        sctx.drawImage(selectionMaskRef.current, 0, 0);
        sctx.globalCompositeOperation = "source-over";
      }
      ctx.save();
      ctx.globalAlpha = paintOpacity;
      ctx.drawImage(scratch, 0, 0);
      ctx.restore();
      lastPaintPt.current = { x, y };
      setComposeTick(t => t + 1);
      return;
    }
    const rgb = hexToRgb(onMask ? "#ffffff" : paintColor);
    const ink = onMask ? "rgba(255,255,255,1)" // la máscara se pinta en blanco (la operación decide el composite)
      : tool === "dodge" && v === "burn" ? "rgba(0,0,0,1)"
      : tool === "dodge" ? "rgba(255,255,255,1)" // exponer
      : `rgba(${rgb},1)`; // pincel/lápiz; la goma usa la tinta como máscara
    for (let i = 1; i <= steps; i++) {
      const t = steps === 1 ? 1 : i / steps;
      const cx = lastPaintPt.current ? lastPaintPt.current.x + (x - lastPaintPt.current.x) * t : x;
      const cy = lastPaintPt.current ? lastPaintPt.current.y + (y - lastPaintPt.current.y) * t : y;
      const pad = radius + 2;
      if (srcMode === "clone" || srcMode === "heal" || srcMode === "history") {
        // contenido del snapshot desplazado (historial: misma posición);
        // heal añade desenfoque de fusión
        sctx.save();
        sctx.beginPath(); sctx.arc(cx, cy, radius, 0, Math.PI * 2); sctx.clip();
        if (srcMode === "heal") sctx.filter = `blur(${Math.max(0.6, radius * 0.08).toFixed(2)}px)`;
        if (snap) sctx.drawImage(snap, cx + offX - pad, cy + offY - pad, pad * 2, pad * 2, cx - pad, cy - pad, pad * 2, pad * 2);
        sctx.restore();
        sctx.filter = "none";
        // borde suave: multiplica el disco por el gradiente
        const soft = sctx.createRadialGradient(cx, cy, radius * 0.35, cx, cy, radius);
        soft.addColorStop(0, "rgba(255,255,255,1)");
        soft.addColorStop(1, "rgba(255,255,255,0)");
        sctx.globalCompositeOperation = "destination-in";
        sctx.fillStyle = soft;
        sctx.fillRect(cx - pad, cy - pad, pad * 2, pad * 2);
        sctx.globalCompositeOperation = "source-over";
      } else if (srcMode === "fx") {
        // reestampa la propia capa con un filtro canvas recortado al disco
        sctx.save();
        sctx.beginPath(); sctx.arc(cx, cy, radius, 0, Math.PI * 2); sctx.clip();
        sctx.filter =
          fxVariant === "blur" ? `blur(${Math.max(1, radius * 0.18).toFixed(2)}px)`
          : fxVariant === "sharpen" ? "contrast(1.35) saturate(1.08)"
          : fxVariant === "sponge" ? `saturate(${e.altKey ? "0.2" : "1.6"})`
          : fxVariant === "redeye" ? "saturate(0.15) brightness(0.9)"
          : `blur(${Math.max(0.5, radius * 0.05).toFixed(2)}px)`; // smudge
        sctx.drawImage(master, fxVariant === "smudge" ? offX : 0, fxVariant === "smudge" ? offY : 0);
        sctx.restore();
        sctx.filter = "none";
        const soft = sctx.createRadialGradient(cx, cy, radius * 0.35, cx, cy, radius);
        soft.addColorStop(0, "rgba(255,255,255,1)");
        soft.addColorStop(1, "rgba(255,255,255,0)");
        sctx.globalCompositeOperation = "destination-in";
        sctx.fillStyle = soft;
        sctx.fillRect(cx - pad, cy - pad, pad * 2, pad * 2);
        sctx.globalCompositeOperation = "source-over";
        if (fxVariant === "sharpen" && sharpenStroke.current) {
          // F4.2d: región barrida por el trazo de Enfocar (unsharp al soltar)
          const b = sharpenStroke.current.bbox;
          b.x0 = Math.min(b.x0, cx - pad); b.y0 = Math.min(b.y0, cy - pad);
          b.x1 = Math.max(b.x1, cx + pad); b.y1 = Math.max(b.y1, cy + pad);
        }
      } else {
        // pincel/lápiz/goma/exponer/quemar: tinta plana con Dureza continua
        const softInk = sctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        const plateau = v === "pencil" ? 0.94 : clamp(paintHardness / 100, 0.02, 0.94);
        softInk.addColorStop(0, ink);
        softInk.addColorStop(plateau, ink);
        softInk.addColorStop(1, ink.replace(/,1\)$/, ",0)"));
        sctx.fillStyle = softInk;
        sctx.beginPath(); sctx.arc(cx, cy, radius, 0, Math.PI * 2); sctx.fill();
      }
    }
    // recorta el trazo a la selección activa
    if (selectionMaskRef.current) {
      sctx.globalCompositeOperation = "destination-in";
      sctx.drawImage(selectionMaskRef.current, 0, 0);
      sctx.globalCompositeOperation = "source-over";
    }
    // vuelca el scratch al master con la operación de la herramienta
    ctx.save();
    if (onMask) {
      // F4.2d: trazo normal OCULTA (borra alpha de la máscara) · Alt REVELA
      ctx.globalAlpha = Math.min(1, pressureK);
      ctx.globalCompositeOperation = e.altKey ? "source-over" : "destination-out";
    } else {
      ctx.globalAlpha = tool === "eraser" || srcMode !== "ink" ? 1
        : tool === "dodge" ? Math.min(1, paintOpacity * 0.35 * pressureK) // exponer/quemar
        : Math.min(1, paintOpacity * Math.max(0.05, paintFlow) * pressureK); // Flujo × presión
      ctx.globalCompositeOperation = tool === "eraser" ? "destination-out"
        : tool === "dodge" && v === "burn" ? "color-burn"
        : tool === "dodge" ? "color-dodge"
        : "source-over";
    }
    ctx.drawImage(scratch, 0, 0);
    ctx.restore();
    lastPaintPt.current = { x, y };
    setComposeTick(t => t + 1); // refresca espejo DOM
  };

  /** Marco de fila/columna (1 px a todo lo ancho/alto) — clic directo, sin arrastre. */
  const commitRowCol = (p: { x: number; y: number }, variant: string) => {
    const mask = ensureSelectionMask();
    const ctx = mask.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, mask.width, mask.height);
    ctx.fillStyle = "#ffffff";
    if (variant === "row") ctx.fillRect(0, Math.round(p.y * mask.height), mask.width, 1);
    else ctx.fillRect(Math.round(p.x * mask.width), 0, 1, mask.height);
    setSelectionBBox(variant === "row" ? { x: 0, y: p.y, w: 1, h: 0.004 } : { x: p.x, y: 0, w: 0.004, h: 1 });
    setSelPreview(null);
    addToast(variant === "row" ? "Fila de 1 px seleccionada." : "Columna de 1 px seleccionada.", "info");
  };

  /** Borrador mágico: flood-fill por color sobre la PROPIA capa (no el snapshot)
   * y destino-out de la región — elimina pintura de un color con un clic. */
  const buildMagicErase = (p: { x: number; y: number }, layerId: string) => {
    pushComposeHistory(); // F4.2d
    const master = layerCanvasesRef.current.get(layerId) || ensureMasterCanvas(layerId);
    const mctx = master.getContext("2d");
    if (!mctx) return;
    const W = Math.max(1, Math.min(512, master.width));
    const H = Math.max(1, Math.round(master.height * (W / master.width)));
    const small = document.createElement("canvas");
    small.width = W; small.height = H;
    const sctx = small.getContext("2d");
    if (!sctx) return;
    sctx.drawImage(master, 0, 0, W, H);
    let px: Uint8ClampedArray;
    try { px = sctx.getImageData(0, 0, W, H).data; } catch { return; }
    const sx = clamp(Math.round(p.x * W), 0, W - 1);
    const sy = clamp(Math.round(p.y * H), 0, H - 1);
    const si = (sy * W + sx) * 4;
    if (px[si + 3] < 8) { addToast("No hay pintura ahí que borrar.", "info"); return; }
    const r0 = px[si], g0 = px[si + 1], b0 = px[si + 2], a0 = px[si + 3];
    const tol = wandTolerance * 3;
    const tol2 = tol * tol * 3;
    const seen = new Uint8Array(W * H);
    const hit = new Uint8Array(W * H);
    const stack: number[] = [sy * W + sx];
    seen[sy * W + sx] = 1;
    let minX = W, minY = H, maxX = -1, maxY = -1;
    while (stack.length) {
      const idx = stack.pop()!;
      const cx = idx % W, cy = (idx - cx) / W;
      const i4 = idx * 4;
      const dr = px[i4] - r0, dg = px[i4 + 1] - g0, db = px[i4 + 2] - b0, da = px[i4 + 3] - a0;
      if (dr * dr + dg * dg + db * db + da * da > tol2) continue;
      hit[idx] = 1;
      if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
      if (cx > 0 && !seen[idx - 1]) { seen[idx - 1] = 1; stack.push(idx - 1); }
      if (cx < W - 1 && !seen[idx + 1]) { seen[idx + 1] = 1; stack.push(idx + 1); }
      if (cy > 0 && !seen[idx - W]) { seen[idx - W] = 1; stack.push(idx - W); }
      if (cy < H - 1 && !seen[idx + W]) { seen[idx + W] = 1; stack.push(idx + W); }
    }
    if (maxX < 0) return;
    const hitCv = document.createElement("canvas");
    hitCv.width = W; hitCv.height = H;
    const hctx = hitCv.getContext("2d");
    if (!hctx) return;
    const out = hctx.createImageData(W, H);
    for (let i = 0; i < hit.length; i++) { if (hit[i]) out.data[i * 4 + 3] = 255; }
    hctx.putImageData(out, 0, 0);
    mctx.save();
    mctx.globalCompositeOperation = "destination-out";
    mctx.drawImage(hitCv, 0, 0, W, H, 0, 0, master.width, master.height);
    mctx.restore();
    setComposeTick(t => t + 1);
    addToast("Borrado mágico aplicado a la capa.", "info");
  };

  /** Degradado v1 (lineal/radial): color → transparente a lo largo del vector
   * arrastrado; recortado por la selección activa si la hay. */
  const commitGradient = (d: { startX: number; startY: number; base: any }, e: React.PointerEvent) => {
    pushComposeHistory(); // F4.2d
    const layer = activeComposeLayer || createLayerNow();
    const master = layerCanvasesRef.current.get(layer.id) || ensureMasterCanvas(layer.id);
    const ctx = master.getContext("2d");
    if (!ctx) return;
    const p0 = d.base as { x: number; y: number };
    const p1 = displayPointToNorm(e);
    const x0 = p0.x * master.width, y0 = p0.y * master.height;
    const x1 = p1.x * master.width, y1 = p1.y * master.height;
    const scratch = ensureScratch();
    const sctx = scratch.getContext("2d");
    if (!sctx) return;
    sctx.clearRect(0, 0, scratch.width, scratch.height);
    const rgb = hexToRgb(paintColor);
    const grad = toolVariant === "radial"
      ? sctx.createRadialGradient(x1, y1, 0, x1, y1, Math.max(2, Math.hypot(x1 - x0, y1 - y0)))
      : sctx.createLinearGradient(x0, y0, x1, y1);
    grad.addColorStop(0, `rgba(${rgb},1)`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, scratch.width, scratch.height);
    if (selectionMaskRef.current) {
      sctx.globalCompositeOperation = "destination-in";
      sctx.drawImage(selectionMaskRef.current, 0, 0);
      sctx.globalCompositeOperation = "source-over";
    }
    ctx.save();
    ctx.globalAlpha = paintOpacity;
    ctx.drawImage(scratch, 0, 0);
    ctx.restore();
    setSelPreview(null);
    setComposeDirty(true);
    setComposeTick(t => t + 1);
  };

  /** Formas v1: trazo del contorno (rect/elipse/línea) con color y tamaño actuales. */
  const commitShape = (d: { kind: string; startX: number; startY: number; base: any }, e: React.PointerEvent) => {
    pushComposeHistory(); // F4.2d
    const layer = activeComposeLayer || createLayerNow();
    const master = layerCanvasesRef.current.get(layer.id) || ensureMasterCanvas(layer.id);
    const ctx = master.getContext("2d");
    if (!ctx) return;
    const p0 = d.base as { x: number; y: number };
    const p1 = displayPointToNorm(e);
    const x0 = p0.x * master.width, y0 = p0.y * master.height;
    const x1 = p1.x * master.width, y1 = p1.y * master.height;
    const scratch = ensureScratch();
    const sctx = scratch.getContext("2d");
    if (!sctx) return;
    sctx.clearRect(0, 0, scratch.width, scratch.height);
    sctx.strokeStyle = paintColor;
    sctx.lineWidth = Math.max(1, paintSize * (master.width / Math.max(1, imgRect.width)));
    sctx.lineCap = "round"; sctx.lineJoin = "round";
    sctx.beginPath();
    if (d.kind === "shape-rect") sctx.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    else if (d.kind === "shape-ellipse") sctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, 0, 0, Math.PI * 2);
    else if (d.kind === "shape-poly") {
      // F4.2e: polígono regular de N lados inscrito en el arrastre (relleno)
      polygonPoints(Math.max(3, shapeSides), (x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2)
        .forEach(([px, py], i) => (i === 0 ? sctx.moveTo(px, py) : sctx.lineTo(px, py)));
      sctx.closePath();
    } else if (d.kind === "shape-custom") {
      // F4.2e: forma personalizada (silueta propia) escalada al arrastre
      drawCustomShapePath(sctx, customShapeId, Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    }
    else { sctx.moveTo(x0, y0); sctx.lineTo(x1, y1); }
    if (d.kind === "shape-poly" || d.kind === "shape-custom") {
      sctx.fillStyle = paintColor;
      sctx.globalAlpha = paintOpacity;
      sctx.fill();
      sctx.globalAlpha = 1;
      sctx.stroke();
    } else sctx.stroke();
    if (selectionMaskRef.current) {
      sctx.globalCompositeOperation = "destination-in";
      sctx.drawImage(selectionMaskRef.current, 0, 0);
      sctx.globalCompositeOperation = "source-over";
    }
    ctx.save();
    ctx.globalAlpha = paintOpacity;
    ctx.drawImage(scratch, 0, 0);
    ctx.restore();
    setSelPreview(null);
    setComposeDirty(true);
    setComposeTick(t => t + 1);
  };

  /** Texto v2 (F4.2d): CAPA DE TEXTO VIVA — crea (o reedita) una capa kind
   * "text" con la definición persistida; el render rasteriza en su master. */
  const commitType = () => {
    const draft = typeDraft;
    setTypeDraft(null);
    if (!draft || !draft.value.trim()) return;
    // F4.2e: Máscara de texto — rasteriza el texto y lo convierte en SELECCIÓN
    if (toolVariant === "typemask") {
      const w = Math.max(1, Math.min(2048, Math.round(outSize.w)));
      const h = Math.max(1, Math.min(2048, Math.round(outSize.h)));
      const tmp = document.createElement("canvas");
      tmp.width = w; tmp.height = h;
      const tctx = tmp.getContext("2d");
      if (!tctx) return;
      const px = Math.max(6, typeSize * (w / Math.max(1, imgRect.width)));
      tctx.fillStyle = "#ffffff";
      tctx.textBaseline = "alphabetic";
      tctx.font = `600 ${px}px ${typeFont}`;
      draft.value.split("\n").forEach((line, i) => tctx.fillText(line, draft.x * w, draft.y * h + i * px * 1.25));
      selectionMaskRef.current = tmp;
      const lines = draft.value.split("\n");
      setSelectionBBox({
        x: draft.x, y: draft.y - 0.003,
        w: Math.min(0.95, 0.012 * (typeSize / 48) * lines.reduce((m, s) => Math.max(m, s.length), 4)),
        h: 0.0016 * typeSize * lines.length + 0.012,
      });
      setSelPreview(null);
      addToast("Texto convertido en selección — rellénala (G → Bote) o pinta dentro.", "info");
      return;
    }
    pushComposeHistory();
    const text = { value: draft.value, size: typeSize, color: paintColor, font: typeFont, x: draft.x, y: draft.y, ...(typeVertical || toolVariant === "typevert" ? { vertical: true } : {}) }; // F4.2e: vertical
    const existingIdx = composeLayers.findIndex(l => l.kind === "text" && l.text
      && Math.abs(l.text.x - draft.x) < 0.02 && Math.abs(l.text.y - draft.y) < 0.03);
    if (existingIdx >= 0) {
      const updated = { ...composeLayers[existingIdx], text };
      setComposeLayers(ls => ls.map((l, i) => (i === existingIdx ? updated : l)));
      rasterTextLayer(updated);
      setActiveLayerId(updated.id);
      addToast("Texto actualizado (capa viva).", "info");
    } else {
      if (composeLayers.length >= MAX_COMPOSITION_LAYERS) {
        addToast(`Máximo ${MAX_COMPOSITION_LAYERS} capas.`, "info");
        return;
      }
      const nl = createTextLayer(composeLayers.length, text);
      setComposeLayers(ls => [...ls, nl]);
      ensureMasterCanvas(nl.id);
      rasterTextLayer(nl);
      setActiveLayerId(nl.id);
      addToast("Capa de texto viva creada — clic sobre ella con la tool Texto para reeditar.", "info");
    }
    setComposeDirty(true);
    setComposeTick(t => t + 1);
  };

  /** Pluma v1: cierra el polígono de puntos clicados y traza su contorno. */
  const closePenPath = () => {
    const pts = penPts;
    setPenPts([]);
    if (pts.length < 3) { if (pts.length) addToast("La pluma necesita al menos 3 puntos.", "info"); return; }
    pushComposeHistory(); // F4.2d
    const layer = activeComposeLayer || createLayerNow();
    const master = layerCanvasesRef.current.get(layer.id) || ensureMasterCanvas(layer.id);
    const ctx = master.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.strokeStyle = paintColor;
    ctx.lineWidth = Math.max(1, paintSize * (master.width / Math.max(1, imgRect.width)));
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px * master.width, py * master.height) : ctx.lineTo(px * master.width, py * master.height)));
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
    setComposeDirty(true);
    setComposeTick(t => t + 1);
    addToast("Trazado cerrado y rasterizado en la capa (v1).", "info");
  };

  /** Capa de pintura SÍNCRONA (estado + master inmediato): la primera pincelada
   * sobre una foto sin capas no puede esperar un re-render para saber su id. */
  const createLayerNow = (): CompositionLayer => {
    const layer = createPaintLayer(composeLayers.length);
    setComposeLayers(ls => [...ls, layer]);
    setActiveLayerId(layer.id);
    setComposeDirty(true);
    composeLoadedRef.current = true;
    return layer;
  };

  const composeAddLayer = () => {
    if (composeLayers.length >= MAX_COMPOSITION_LAYERS) { addToast(`Máximo ${MAX_COMPOSITION_LAYERS} capas.`, "info"); return; }
    pushComposeHistory(true); // F4.2d
    createLayerNow();
    setTool("brush");
    addToast("Capa creada — pinta sobre la foto con el pincel.", "info");
  };

  /** Cuentagotas: lee 1px del snapshot del revelado y lo fija como color. */
  const pickColorAt = (p: { x: number; y: number }) => {
    const snap = ensureSnapshot();
    const ctx = snap?.getContext("2d");
    if (!snap || !ctx) return;
    const d = ctx.getImageData(
      clamp(Math.round(p.x * snap.width), 0, snap.width - 1),
      clamp(Math.round(p.y * snap.height), 0, snap.height - 1), 1, 1).data;
    const hex = "#" + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, "0")).join("");
    setPaintColor(hex);
    addToast(`Color capturado: ${hex}`, "info");
  };

  /** Varita mágica: flood-fill por color sobre un snapshot reducido (≤512).
   * Produce la máscara de selección + bbox; pinta, rellena o parche la usan. */
  const buildWandMask = (p: { x: number; y: number }, selMode: "new" | "add" | "sub" = "new") => {
    const snap = ensureSnapshot();
    if (!snap) return;
    const W = Math.max(1, Math.min(512, snap.width));
    const H = Math.max(1, Math.round(snap.height * (W / snap.width)));
    const small = document.createElement("canvas");
    small.width = W; small.height = H;
    const sctx = small.getContext("2d");
    if (!sctx) return;
    sctx.drawImage(snap, 0, 0, W, H);
    const px = sctx.getImageData(0, 0, W, H).data;
    const sx = clamp(Math.round(p.x * W), 0, W - 1);
    const sy = clamp(Math.round(p.y * H), 0, H - 1);
    const si = (sy * W + sx) * 4;
    const r0 = px[si], g0 = px[si + 1], b0 = px[si + 2];
    const tol = wandTolerance * 3;
    const tol2 = tol * tol * 3;
    const seen = new Uint8Array(W * H);
    const hit = new Uint8Array(W * H);
    const stack: number[] = [sy * W + sx];
    seen[sy * W + sx] = 1;
    let minX = W, minY = H, maxX = -1, maxY = -1, count = 0;
    while (stack.length) {
      const idx = stack.pop()!;
      const cx = idx % W, cy = (idx - cx) / W;
      const i4 = idx * 4;
      const dr = px[i4] - r0, dg = px[i4 + 1] - g0, db = px[i4 + 2] - b0;
      if (dr * dr + dg * dg + db * db > tol2) continue;
      hit[idx] = 1; count++;
      if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
      if (cx > 0 && !seen[idx - 1]) { seen[idx - 1] = 1; stack.push(idx - 1); }
      if (cx < W - 1 && !seen[idx + 1]) { seen[idx + 1] = 1; stack.push(idx + 1); }
      if (cy > 0 && !seen[idx - W]) { seen[idx - W] = 1; stack.push(idx - W); }
      if (cy < H - 1 && !seen[idx + W]) { seen[idx + W] = 1; stack.push(idx + W); }
    }
    if (maxX < 0) return;
    const hitCv = document.createElement("canvas");
    hitCv.width = W; hitCv.height = H;
    const hctx = hitCv.getContext("2d");
    if (!hctx) return;
    const out = hctx.createImageData(W, H);
    for (let i = 0; i < hit.length; i++) {
      if (hit[i]) { out.data[i * 4] = 255; out.data[i * 4 + 1] = 255; out.data[i * 4 + 2] = 255; out.data[i * 4 + 3] = 255; }
    }
    hctx.putImageData(out, 0, 0);
    // F4.2d: añadir/quitar sobre la selección existente (Shift/Alt)
    const mask = selMode !== "new" && selectionMaskRef.current ? selectionMaskRef.current : ensureSelectionMask();
    const prevBBox = selMode !== "new" ? selectionBBox : null;
    const mctx = mask.getContext("2d");
    if (!mctx) return;
    if (selMode === "new") mctx.clearRect(0, 0, mask.width, mask.height);
    if (selMode === "sub") mctx.globalCompositeOperation = "destination-out";
    mctx.drawImage(hitCv, 0, 0, W, H, 0, 0, mask.width, mask.height);
    mctx.globalCompositeOperation = "source-over";
    const wandBBox = { x: minX / W, y: minY / H, w: (maxX - minX + 1) / W, h: (maxY - minY + 1) / H };
    setSelectionBBox(selMode === "sub" ? (prevBBox || wandBBox) : unionBBox(prevBBox, wandBBox));
    setSelPreview(null);
    applyFeatherToMask();
    addToast(selMode === "add"
      ? `Varita (+): ${count.toLocaleString("es")} px añadidos a la selección.`
      : selMode === "sub"
        ? "Varita (−): zona restada de la selección."
        : `Varita: ${count.toLocaleString("es")} px seleccionados. Pinta, rellena (bote, G) o aplica el parche (J → Parche).`, "info");
  };

  /** Bote de pintura: rellena la selección activa (o toda la capa si no hay). */
  const fillSelection = (layerId: string) => {
    pushComposeHistory(); // F4.2d
    const master = layerCanvasesRef.current.get(layerId) || ensureMasterCanvas(layerId);
    const ctx = master.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.globalAlpha = paintOpacity;
    ctx.fillStyle = paintColor;
    if (selectionMaskRef.current) {
      const tmp = ensureScratch();
      const tctx = tmp.getContext("2d");
      if (!tctx) { ctx.restore(); return; }
      tctx.clearRect(0, 0, tmp.width, tmp.height);
      tctx.fillStyle = paintColor;
      tctx.fillRect(0, 0, tmp.width, tmp.height);
      tctx.globalCompositeOperation = "destination-in";
      tctx.drawImage(selectionMaskRef.current, 0, 0);
      tctx.globalCompositeOperation = "source-over";
      ctx.drawImage(tmp, 0, 0);
      addToast("Selección rellenada.", "info");
    } else {
      ctx.fillRect(0, 0, master.width, master.height);
      addToast("Capa rellenada (sin selección activa).", "info");
    }
    ctx.restore();
    setComposeTick(t => t + 1);
  };

  /** Marco/lazo: convierte la previsualización en máscara de selección.
   * F4.2d: mode "add" une a la selección existente, "sub" la resta, y el
   * Feather (px de pantalla) difumina el borde al commit. */
  const commitSelection = (mode: "new" | "add" | "sub" = "new") => {
    const prev = selPreview;
    if (!prev) return;
    const mask = mode !== "new" && selectionMaskRef.current ? selectionMaskRef.current : ensureSelectionMask();
    const prevBBox = mode !== "new" ? selectionBBox : null;
    const ctx = mask.getContext("2d");
    if (!ctx) return;
    if (mode === "new") ctx.clearRect(0, 0, mask.width, mask.height);
    if (mode === "sub") ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "#ffffff";
    let shapeBBox: { x: number; y: number; w: number; h: number } | null = null;
    if (prev.kind === "rect") {
      ctx.fillRect(prev.x * mask.width, prev.y * mask.height, Math.max(1, prev.w * mask.width), Math.max(1, prev.h * mask.height));
      shapeBBox = { x: prev.x, y: prev.y, w: prev.w, h: prev.h };
    } else if (prev.kind === "ellipse") {
      ctx.beginPath();
      ctx.ellipse((prev.x + prev.w / 2) * mask.width, (prev.y + prev.h / 2) * mask.height,
        Math.max(1, (prev.w / 2) * mask.width), Math.max(1, (prev.h / 2) * mask.height), 0, 0, Math.PI * 2);
      ctx.fill();
      shapeBBox = { x: prev.x, y: prev.y, w: prev.w, h: prev.h };
    } else if (prev.kind === "poly") {
      if (prev.pts.length < 3) { clearSelection(); return; }
      ctx.beginPath();
      prev.pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px * mask.width, py * mask.height) : ctx.lineTo(px * mask.width, py * mask.height)));
      ctx.closePath();
      ctx.fill();
      shapeBBox = polyBBox(prev.pts);
    }
    ctx.globalCompositeOperation = "source-over";
    if (!shapeBBox) return; // sin forma válida no hay nada que commitear
    setSelectionBBox(mode === "sub" ? (prevBBox || shapeBBox) : unionBBox(prevBBox, shapeBBox));
    setSelPreview(null);
    applyFeatherToMask();
    addToast(mode === "add" ? "Selección ampliada (Shift)."
      : mode === "sub" ? "Zona restada de la selección (Alt)."
      : "Selección lista — pincel, goma, relleno y parche la respetan.", "info");
  };

  /** Parche (v1): arrastra la selección; el área se rellena con el entorno del
   * snapshot desplazado por el delta del arrastre, con costura difuminada. */
  const commitPatch = (startX: number, startY: number, e: React.PointerEvent) => {
    const snap = ensureSnapshot();
    const layer = activeComposeLayer;
    const mask = selectionMaskRef.current;
    if (!snap || !layer || !mask || !selectionBBox) {
      addToast("El parche necesita una selección y una capa activa.", "info");
      return;
    }
    pushComposeHistory(); // F4.2d
    const master = layerCanvasesRef.current.get(layer.id) || ensureMasterCanvas(layer.id);
    const ctx = master.getContext("2d");
    if (!ctx) return;
    const scale = master.width / Math.max(1, imgRect.width);
    const dx = (e.clientX - startX) * scale;
    const dy = (e.clientY - startY) * scale;
    const scratch = ensureScratch();
    const sctx = scratch.getContext("2d");
    if (!sctx) return;
    sctx.clearRect(0, 0, scratch.width, scratch.height);
    sctx.filter = "blur(2px)"; // difumina la costura del parche
    sctx.drawImage(snap, dx, dy);
    sctx.filter = "none";
    sctx.globalCompositeOperation = "destination-in";
    sctx.drawImage(mask, 0, 0);
    sctx.globalCompositeOperation = "source-over";
    ctx.drawImage(scratch, 0, 0);
    setComposeDirty(true);
    setComposeTick(t => t + 1);
    addToast("Parche aplicado — v1 reemplaza con el entorno desplazado.", "info");
  };

  /** Cambia el GRUPO activo (y su variante si llega del flyout); orquesta modos
   * y avisa honestamente cuando la variante aún no existe — cero tools fantasma. */
  const pickGroup = (g: PhotoGroupId, vId?: string) => {
    const grp = GROUP_BY_ID.get(g);
    if (!grp) return;
    const vid = vId || toolVariants[g] || defaultVariantOf(g);
    const vdef = findVariant(g, vid);
    if (vdef?.status === "soon") {
      setToolNotice(`${vdef.label.replace(/\s*\(.*$/, "")}: llega en F4.5 — sigue activa la variante actual.`);
      return;
    }
    setToolNotice(null);
    setTypeDraft(null);
    setPenPts([]);
    setTool(g);
    if (vId) setToolVariants(s => ({ ...s, [g]: vId }));
    if (g === "crop") { enterCropMode(); return; }
    if (g === "masks") {
      setMode("edit");
      setTab("mascaras");
      addToast("Máscaras: crea una en el inspector (radial, gradiente o pincel).", "info");
      return;
    }
    if (grp.paint && mode !== "compose") {
      setMode("compose");
      if (!composeLoadedRef.current) void loadComposition();
    }
  };

  const composePatchLayer = (id: string, patch: Partial<CompositionLayer>) => {
    pushComposeHistoryMeta(); // F4.2d
    setComposeLayers(ls => ls.map(l => (l.id === id ? { ...l, ...patch } : l)));
    setComposeDirty(true);
  };

  const composePatchTransform = (patch: Partial<CompositionLayerTransform>) => {
    if (!activeLayerId) return;
    pushComposeHistoryMeta(); // F4.2d
    setComposeLayers(ls => ls.map(l => (l.id === activeLayerId ? { ...l, transform: { ...l.transform, ...patch } } : l)));
    setComposeDirty(true);
  };

  /** dir=+1 sube la capa en el stack (hacia el final del array = más arriba). */
  const composeMoveLayer = (id: string, dir: -1 | 1) => {
    pushComposeHistoryMeta(); // F4.2d
    setComposeLayers(ls => {
      const i = ls.findIndex(l => l.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= ls.length) return ls;
      const next = [...ls];
      const [item] = next.splice(i, 1);
      next.splice(j, 0, item);
      return next;
    });
    setComposeDirty(true);
  };

  const composeDeleteLayer = (id: string) => {
    pushComposeHistory(); // F4.2d: undo de borrado necesita el master
    setComposeLayers(ls => ls.filter(l => l.id !== id));
    layerCanvasesRef.current.delete(id);
    mirrorCanvasesRef.current.delete(id);
    layerMasksRef.current.delete(id);
    setMaskEditId(m => (m === id ? null : m));
    setActiveLayerId(a => (a === id ? null : a));
    setComposeDirty(true);
  };

  const loadComposition = useCallback(async () => {
    if (!workspaceId || !active) return;
    try {
      const res = await apiFetch<any>(`/api/photos/composition?workspaceId=${encodeURIComponent(workspaceId)}&sourceUrl=${encodeURIComponent(active.src)}`);
      const layers = normalizeCompositionLayers(((res?.composition?.layers) ?? []).map((l: any) => ({ ...l, persisted: true })));
      layerCanvasesRef.current.clear();
      mirrorCanvasesRef.current.clear();
      layerMasksRef.current.clear();
      setComposeLayers(layers);
      // F4.2e: decodifica las máscaras persistidas (v60) en sus canvas
      for (const l of layers) {
        if (!l.mask) continue;
        const img = new Image();
        img.onload = () => {
          const cv = document.createElement("canvas");
          cv.width = Math.max(1, Math.min(2048, Math.round(outSize.w)));
          cv.height = Math.max(1, Math.min(2048, Math.round(outSize.h)));
          cv.getContext("2d")?.drawImage(img, 0, 0, cv.width, cv.height);
          layerMasksRef.current.set(l.id, cv);
          setComposeTick(t => t + 1);
        };
        img.src = l.mask;
      }
      setActiveLayerId(layers.length ? layers[layers.length - 1].id : null);
      setComposeDirty(false);
      if (layers.length) addToast(`Composición cargada (${layers.length} capa${layers.length === 1 ? "" : "s"}).`, "info");
    } catch {
      addToast("No se pudo cargar la composición guardada (¿migración v60 aplicada?).", "error");
      setComposeLayers([]);
      setComposeDirty(false);
    } finally {
      composeLoadedRef.current = true; // habilita pintar aunque la carga falle
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, active?.src]);

  const enterComposeMode = () => {
    setMode("compose");
    void loadComposition();
  };

  const saveComposition = async () => {
    if (!workspaceId || !active) return;
    setComposeSaving(true);
    try {
      const payload = composeLayers.map(l => {
        const cv = layerCanvasesRef.current.get(l.id);
        const mk = layerMasksRef.current.get(l.id);
        // F4.2e: la máscara viaja dentro de la capa (migración v60)
        return { ...l, dataUrl: cv ? cv.toDataURL("image/png") : l.dataUrl, ...(mk ? { mask: mk.toDataURL("image/png") } : {}) };
      });
      const total = payload.reduce((s, l) => s + l.dataUrl.length + (l.mask?.length || 0), 0);
      if (total > 8_000_000) throw new Error("La composición excede 8MB — borra alguna capa.");
      await apiFetch("/api/photos/composition", {
        method: "PUT",
        body: JSON.stringify({ workspaceId, sourceUrl: active.src, layers: payload }),
      });
      setComposeDirty(false);
      addToast("Composición guardada.", "success");
    } catch (e: any) {
      addToast(e?.message || "No se pudo guardar la composición", "error");
    } finally { setComposeSaving(false); }
  };

  /** Aplana revelado WebGL + capas visibles a un solo bitmap. Los blend de
   * CSS y de canvas globalCompositeOperation comparten nombres (normal ≙
   * source-over) — mismo resultado que el stack DOM del visor. */
  const flattenComposition = async (maxSide: number, type: "image/jpeg" | "image/png", quality?: number): Promise<Blob> => {
    const renderer = rendererRef.current;
    if (!renderer) throw new Error("Renderer no listo");
    const baseBlob = await renderer.renderToBlob("image/jpeg", 0.92, maxSide);
    const base = await createImageBitmap(baseBlob);
    const cv = document.createElement("canvas");
    cv.width = base.width; cv.height = base.height;
    const ctx = cv.getContext("2d")!;
    ctx.drawImage(base, 0, 0);
    for (const layer of composeLayers) {
      if (!layer.visible) continue;
      const src = layerCanvasesRef.current.get(layer.id);
      if (!src) continue;
      ctx.save();
      ctx.globalCompositeOperation = blendToCanvasOp(layer.blend);
      ctx.globalAlpha = Math.min(1, Math.max(0, layer.opacity));
      // mismo orden que el CSS del stack: translate → rotate → scale (centro)
      ctx.translate(cv.width / 2 + layer.transform.x * cv.width, cv.height / 2 + layer.transform.y * cv.height);
      ctx.rotate((layer.transform.rotation * Math.PI) / 180);
      ctx.scale(layer.transform.scale, layer.transform.scale);
      if (layer.adjust) ctx.filter = adjustFilterOf(layer.adjust); // F4.2e: ajustes de capa
      ctx.drawImage(src, -cv.width / 2, -cv.height / 2, cv.width, cv.height);
      if (layer.adjust) ctx.filter = "none";
      const mk = layerMasksRef.current.get(layer.id); // F4.2d: respeta la máscara de capa
      if (mk) {
        ctx.globalCompositeOperation = "destination-in";
        ctx.drawImage(mk, -cv.width / 2, -cv.height / 2, cv.width, cv.height);
        ctx.globalCompositeOperation = "source-over";
      }
      ctx.restore();
    }
    return await new Promise<Blob>((resolve, reject) =>
      cv.toBlob(b => (b ? resolve(b) : reject(new Error("No se pudo aplanar la composición"))), type, quality));
  };

  const hasVisibleComposeLayers = composeLayers.some(l => l.visible && layerCanvasesRef.current.has(l.id));

  // ── crop helpers ──
  const sourceRectToDisplayRect = (rect: NormRect, g: GeometryParams): NormRect => {
    let { x, y, w, h } = rect;
    const k = g.rotate90 % 4;
    if (k === 1) { const nx = 1 - y - h, ny = x; x = nx; y = ny; const t = w; w = h; h = t; }
    else if (k === 2) { x = 1 - x - w; y = 1 - y - h; }
    else if (k === 3) { const nx = y, ny = 1 - x - w; x = nx; y = ny; const t = w; w = h; h = t; }
    if (g.flipH) x = 1 - x - w;
    if (g.flipV) y = 1 - y - h;
    return { x, y, w, h };
  };

  const enterCropMode = () => {
    setCropDraft(sourceRectToDisplayRect(recipe.geometry.crop, recipe.geometry));
    setAspect(null);
    setMode("crop");
  };

  const applyAspect = (ratio: number | null) => {
    setAspect(ratio);
    if (ratio == null) return;
    const outAspect = outSize.w / outSize.h;
    setCropDraft(r => {
      let { x, y, w, h } = r;
      const target = ratio / outAspect; // h relativo en unidades de display
      if (w / h > target) h = w / target; else w = h * target;
      x = clamp(x, 0, 1 - w); y = clamp(y, 0, 1 - h);
      return { x, y, w, h };
    });
  };

  // ── acciones de receta ──
  const mutateRecipe = (fn: (r: AnyRecipe) => void) => {
    past.current.push(JSON.stringify(recipe));
    if (past.current.length > 60) past.current.shift();
    future.current = [];
    setRecipe(r => {
      const next = JSON.parse(JSON.stringify(r)) as AnyRecipe;
      fn(next);
      return normalizeRecipe(next);
    });
    setHistVersion(v => v + 1);
  };
  const setOp = (type: string, params: Record<string, unknown>) => {
    setRecipe(r => {
      const next = JSON.parse(JSON.stringify(r)) as AnyRecipe;
      const op = next.ops.find(o => o.type === type);
      if (op) op.params = { ...op.params, ...params };
      return normalizeRecipe(next);
    });
  };

  const addMask = (kind: MaskKind) => {
    const id = `mask_${Date.now().toString(36)}`;
    mutateRecipe(r => {
      r.masks.push({
        id, kind, enabled: true, feather: 0.5, invert: false,
        cx: 0.5, cy: 0.5, r: 0.35, x1: 0.25, y1: 0.5, x2: 0.75, y2: 0.5,
        adjustments: { exposure: 0, contrast: 0, saturation: 0, temp: 0, tint: 0 },
      } satisfies PhotoMask as PhotoMask);
    });
    setSelectedMaskId(id);
    setTab("mascaras");
    if (kind === "brush") { setMode("brush"); addToast("Pinta sobre la foto para construir la máscara.", "info"); }
  };

  // ── salida (REQ §5) ──
  const buildVariant = async (maxSide: number): Promise<{ dataUrl: string; recipeAttr: string }> => {
    const renderer = rendererRef.current;
    if (!renderer) throw new Error("Renderer no listo");
    // la variante sale del estado ACTUAL (recipe), sin split ni "ver original";
    // tope de lado mayor (4096) para respetar el cap de 5MB de /api/assets/upload
    const blob = hasVisibleComposeLayers
      ? await flattenComposition(maxSide, "image/jpeg", 0.92) // capas aplanadas sobre el revelado
      : await renderer.renderToBlob("image/jpeg", 0.92, maxSide);
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error("No se pudo codificar la variante"));
      fr.readAsDataURL(blob);
    });
    return { dataUrl, recipeAttr: encodeRecipeAttr(recipe) };
  };

  const uploadVariant = async (): Promise<string> => {
    const { dataUrl } = await buildVariant(4096);
    const res = await apiFetch<any>("/api/assets/upload", {
      method: "POST",
      body: JSON.stringify({ name: `Foto editada — ${active?.name || "foto"}`, data: dataUrl, workspaceId }),
    });
    if (!res?.url) throw new Error(res?.error || "La subida de la variante falló");
    return String(res.url);
  };

  const handleApplyToLayer = async () => {
    if (!active) return;
    setBusy(true);
    try {
      const variantUrl = await uploadVariant();
      onApplyToLayer({ ...active, src: effectiveSrc }, variantUrl, encodeRecipeAttr(recipe));
      addToast("Variante aplicada a la capa — el original sigue intacto en data-orig-src.", "success");
    } catch (e: any) {
      addToast(e?.message || "No se pudo aplicar la variante", "error");
    } finally { setBusy(false); }
  };

  const instanceCount = active ? (groups.get(active.src)?.length || 0) : 0;

  const handleApplyToAll = async () => {
    if (!active) return;
    if (!window.confirm(`¿Aplicar esta variante a las ${instanceCount} capa(s) que usan esta misma foto? El original no se toca y Ctrl+Z lo revierte.`)) return;
    setBusy(true);
    try {
      const variantUrl = await uploadVariant();
      onApplyToAllInstances(active.src, variantUrl, encodeRecipeAttr(recipe));
      addToast(`Variante aplicada a ${instanceCount} instancia(s).`, "success");
    } catch (e: any) {
      addToast(e?.message || "No se pudo aplicar a todas las instancias", "error");
    } finally { setBusy(false); }
  };

  const handleSaveRecipe = async () => {
    if (!active || !recipeHasEdits(recipe)) { addToast("No hay ajustes que guardar todavía.", "info"); return; }
    setBusy(true);
    try {
      const attr = encodeRecipeAttr(recipe);
      if (!docId) {
        const res = await apiFetch<any>("/api/photos/documents", {
          method: "POST",
          body: JSON.stringify({ workspaceId, sourceUrl: effectiveSrc, recipe, label: "Base" }),
        });
        setDocId(res?.document?.id || null);
      } else {
        await apiFetch<any>(`/api/photos/documents/${docId}/versions`, {
          method: "POST",
          body: JSON.stringify({ recipe, label: `Edición ${new Date().toLocaleString()}` }),
        });
      }
      // la receta queda embebida en la capa al aplicar; aquí solo persistimos
      void attr;
      addToast("Receta guardada como versión.", "success");
      const fresh = await apiFetch<any>(`/api/photos/documents?workspaceId=${encodeURIComponent(workspaceId)}&sourceUrl=${encodeURIComponent(effectiveSrc)}`);
      setVersions(fresh?.versions || []);
    } catch (e: any) {
      addToast(e?.message || "No se pudo guardar la receta", "error");
    } finally { setBusy(false); }
  };

  const handleExportPng = async () => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    setBusy(true);
    try {
      const blob = hasVisibleComposeLayers
        ? await flattenComposition(4096, "image/png")
        : await renderer.renderToBlob("image/png");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `foto_${(active?.name || "editada").replace(/[^\w-]+/g, "_").slice(0, 40)}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      addToast("PNG exportado — el diseño no cambió.", "success");
    } catch (e: any) {
      addToast(e?.message || "No se pudo exportar", "error");
    } finally { setBusy(false); }
  };

  const handleCreateEditableCopy = async () => {
    if (!active) return;
    setCreatingCopy(true);
    try {
      const res = await apiFetch<any>("/api/assets/upload", {
        method: "POST",
        body: JSON.stringify({ name: active.name, url: active.src, workspaceId }),
      });
      if (!res?.url) throw new Error(res?.error || "No se pudo copiar el asset");
      const src = await loadPhotoSource(String(res.url));
      setImgDims({ w: src.width, h: src.height });
      rendererRef.current?.setSource(src.bitmap, src.width, src.height);
      setEffectiveSrc(String(res.url));
      setLoadError(null);
      setSrcVersion(v => v + 1);
      addToast("Copia editable creada en Assets — ahora sí se puede revelar.", "success");
    } catch (e: any) {
      addToast(e?.message || "No se pudo crear la copia editable", "error");
    } finally { setCreatingCopy(false); }
  };

  // ── atajos de teclado propios del modo ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input, textarea, select")) return;
      const mod = e.metaKey || e.ctrlKey;
      // F4.2d: en Componer, Ctrl+Z/Y deshacen la COMPOSICIÓN (no la receta)
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); if (mode === "compose") composeUndo(); else undo(); }
      else if ((mod && e.key.toLowerCase() === "y") || (mod && e.shiftKey && e.key.toLowerCase() === "z")) { e.preventDefault(); if (mode === "compose") composeRedo(); else redo(); }
      else if (mod && e.shiftKey && e.key.toLowerCase() === "i") { e.preventDefault(); invertSelection(); }
      else if (mod && e.key.toLowerCase() === "t") { e.preventDefault(); enterTfDraft(); } // F4.2d: transformación libre
      else if (mod && !e.shiftKey && e.key.toLowerCase() === "j") { e.preventDefault(); if (mode === "compose" && activeComposeLayer) composeDuplicateLayer(activeComposeLayer.id); } // F4.2e: duplicar capa
      else if (mod && e.shiftKey && e.key.toLowerCase() === "e") { e.preventDefault(); if (mode === "compose") composeFlattenLayers(); } // F4.2e: aplanar imagen
      else if (mod && e.key.toLowerCase() === "e") { e.preventDefault(); if (mode === "compose" && activeComposeLayer) composeMergeDown(activeComposeLayer.id); } // F4.2e: fusionar hacia abajo
      else if (mod && e.key.toLowerCase() === "c") { e.preventDefault(); if (mode === "compose") copySelectionToClipboard(); } // F4.2e: copiar
      else if (mod && e.key.toLowerCase() === "v") { e.preventDefault(); if (mode === "compose") pasteClipboardAsLayer(); } // F4.2e: pegar
      else if (!mod && e.key.toLowerCase() === "q") { e.preventDefault(); toggleQuickMask(); } // F4.2e: máscara rápida
      else if (e.key === "Escape") {
        // Esc cancela primero los borradores (texto/pluma/transformar), luego selección/modo
        if (typeDraft) setTypeDraft(null);
        else if (penPts.length) setPenPts([]);
        else if (tfDraft) setTfDraft(null);
        else { clearSelection(); if (mode !== "edit") setMode("edit"); else if (split != null) setSplit(null); else onClose(); }
      }
      else if (e.key === "Enter") {
        if (typeDraft) { e.preventDefault(); commitType(); }
        else if (tfDraft) { e.preventDefault(); commitTfDraft(); }
        else if (penPts.length >= 3) { e.preventDefault(); closePenPath(); }
        else if (selPreview?.kind === "poly") { e.preventDefault(); commitSelection(); }
      }
      else if (e.key === "0") setView({ zoom: 1, panX: 0, panY: 0 });
      else if (e.key === "b" && activeMask) setMode(m => (m === "brush" ? "edit" : "brush"));
      else if (e.key === "[" || e.key === "]") {
        // F4.2d: corchetes de tamaño de pincel (estándar Photoshop)
        setPaintSize(s => clamp(s + (e.key === "]" ? 4 : -4), 1, 400));
      }
      else if (e.key.toLowerCase() === "x") { setPaintColor(bgColor); setBgColor(paintColor); } // F4.2d: X alterna
      else if (e.key.toLowerCase() === "d") { setPaintColor("#ffffff"); setBgColor("#000000"); } // D restablece
      else if (e.key.startsWith("Arrow") && mode === "compose" && activeLayerId) {
        // F4.2d: flechas desplazan la capa activa (fino · Shift = grueso)
        e.preventDefault();
        const step = e.shiftKey ? 0.01 : 0.002;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        pushComposeHistoryMeta();
        setComposeLayers(ls => ls.map(l => (l.id === activeLayerId
          ? { ...l, transform: { ...l.transform, x: clamp(l.transform.x + dx, -2, 2), y: clamp(l.transform.y + dy, -2, 2) } }
          : l)));
        setComposeDirty(true);
      }
      else if (e.key === "Delete" || e.key === "Backspace") {
        // Supr: borra el contenido de la selección en la capa activa
        if (mode === "compose" && selectionMaskRef.current && activeComposeLayer) {
          pushComposeHistory();
          const master = layerCanvasesRef.current.get(activeComposeLayer.id);
          const mctx = master?.getContext("2d");
          const tmp = ensureScratch();
          const tctx = tmp.getContext("2d");
          if (mctx && tctx) {
            tctx.clearRect(0, 0, tmp.width, tmp.height);
            tctx.drawImage(selectionMaskRef.current, 0, 0);
            mctx.save();
            mctx.globalCompositeOperation = "destination-out";
            mctx.drawImage(tmp, 0, 0);
            mctx.restore();
            setComposeDirty(true);
            setComposeTick(v => v + 1);
          }
        }
      }
      else if (!mod && GROUP_BY_KEY.has(e.key.toLowerCase())) {
        e.preventDefault();
        const g = GROUP_BY_KEY.get(e.key.toLowerCase())!;
        // F4.2d: Shift+letra cicla las variantes usables del grupo activo (M: marco→elipse…)
        if (e.shiftKey && g === tool) {
          const grp = GROUP_BY_ID.get(g);
          const usable = grp ? grp.variants.filter(x => x.status !== "soon") : [];
          if (usable.length > 1) {
            const cur = toolVariants[g] || defaultVariantOf(g);
            const idx = usable.findIndex(v => v.id === cur);
            pickGroup(g, usable[(idx + 1) % usable.length].id);
          }
        } else pickGroup(g);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undo, redo, mode, split, activeMask, tool, toolVariants, typeDraft, typeFont, penPts, selPreview, selectionBBox, tfDraft, bgColor, selFeather, composeLayers, activeLayerId, paintColor, paintSize, typeSize, qmask, samBusy, active, typeVertical, shapeSides, customShapeId, patternKind, patternTile]);

  // F4.2d: espacio = mano temporal (estándar Photoshop), sin scrollear la página
  useEffect(() => {
    const isTyping = (t: EventTarget | null) => !!(t as HTMLElement)?.closest?.("input, textarea, select");
    const dn = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTyping(e.target)) { e.preventDefault(); setSpaceDown(true); }
    };
    const up = (e: KeyboardEvent) => { if (e.code === "Space") setSpaceDown(false); };
    window.addEventListener("keydown", dn);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", dn); window.removeEventListener("keyup", up); };
  }, []);

  // Fase 4.2c: el aviso de variantes "pronto" se disuelve solo
  useEffect(() => {
    if (!toolNotice) return;
    const t = setTimeout(() => setToolNotice(null), 3200);
    return () => clearTimeout(t);
  }, [toolNotice]);

  // ═══ render ═══

  if (targets.length === 0 && !initialTarget) {
    return (
      <div style={{ position: "absolute", inset: 0, zIndex: 5, background: "#0a0a0a", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", maxWidth: 420 }}>
          <div style={{ fontSize: 13, color: "#e0d6c0", marginBottom: 8 }}>Modo Foto — sin fotos raster en el diseño</div>
          <div style={muted}>Sube una imagen desde la barra Insertar o selecciona una capa de imagen y pulsa "Editar foto".</div>
          <button type="button" onClick={onClose} style={{ ...smallBtn, marginTop: 14 }}>← Volver al diseño</button>
        </div>
      </div>
    );
  }

  const edited = recipeHasEdits(recipe);

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 5, background: "#0a0a0a", display: "flex", flexDirection: "column", color: "#f0ebe0", fontFamily: "inherit", overflow: "hidden" }}>
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>

        {/* ── Rail de herramientas estilo Photoshop (Fase 4.2b) ── */}
        <PhotoToolRail
          tool={tool}
          variants={toolVariants}
          disabled={!!glError || !!loadError}
          paintColor={paintColor}
          bgColor={bgColor}
          onColor={setPaintColor}
          onBgColor={setBgColor}
          onPick={pickGroup}
          onPickVariant={pickGroup}
        />

        {/* ── Izquierda: filmstrip + histograma ── */}
        <div style={{ flex: "0 0 224px", borderRight: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", minHeight: 0, background: "#0d0d0d" }}>
          <div style={{ padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, color: "#c8b898" }}>MODO FOTO</span>
              <span style={{ display: "flex", gap: 4 }}>
                <button type="button" style={leftTab === "fotos" ? smallBtnActive : smallBtn} onClick={() => setLeftTab("fotos")}>Fotos</button>
                <button type="button" style={leftTab === "biblioteca" ? smallBtnActive : smallBtn} onClick={() => setLeftTab("biblioteca")} title="Catálogo del workspace (REQ Fase 3)">Biblioteca</button>
              </span>
            </div>
            <div style={muted}>{targets.length} foto{targets.length === 1 ? "" : "s"} en el diseño</div>
          </div>
          {leftTab === "biblioteca" ? (
            <PhotoLibraryPanel
              workspaceId={workspaceId}
              targets={targets}
              onOpenSrc={(src) => {
                const t = targets.find(x => x.src === src);
                if (t) { setActive(t); setLeftTab("fotos"); }
              }}
            />
          ) : (
          <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
            {targets.map((t, i) => (
              <button key={`${t.frameId}:${t.layerId}:${i}`} type="button" onClick={() => setActive(t)}
                title={`${t.name} · ${t.frameId ? "frame" : "objeto"}`}
                style={{
                  display: "block", width: "100%", marginBottom: 6, padding: 0, borderRadius: 4, overflow: "hidden",
                  border: active && t.layerId === active.layerId && t.frameId === active.frameId ? "2px solid #c8b898" : "2px solid transparent",
                  background: "#161616", cursor: "pointer",
                }}>
                <img src={t.src} alt={t.name} loading="lazy" draggable={false}
                  style={{ width: "100%", height: 74, objectFit: "cover", display: "block" }} />
              </button>
            ))}
          </div>
          )}
          <div style={{ padding: 10, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
            <div style={{ ...muted, marginBottom: 4 }}>Histograma</div>
            <HistogramView data={histogram} />
            {imgDims && (
              <div style={{ ...muted, marginTop: 6 }}>
                {imgDims.w}×{imgDims.h}px → salida {outSize.w}×{outSize.h}px
              </div>
            )}
          </div>
        </div>

        {/* ── Centro: toolbar + visor + salida ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <button type="button" style={mode === "edit" ? smallBtnActive : smallBtn} onClick={() => setMode("edit")}>Editar</button>
            <button type="button" style={mode === "crop" ? smallBtnActive : smallBtn} onClick={enterCropMode}>Recortar</button>
            <button type="button" style={mode === "compose" ? smallBtnActive : smallBtn}
              onClick={enterComposeMode} title="Capas de pintura con blend/opacity (Fase 4)">Componer</button>
            {activeMask && (
              <button type="button" style={mode === "brush" ? smallBtnActive : smallBtn}
                onClick={() => setMode(m => (m === "brush" ? "edit" : "brush"))}
                title="Pintar la máscara seleccionada">Pincel máscara</button>
            )}
            <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.1)" }} />
            <button type="button" style={smallBtn} onClick={undo} title="Deshacer (Ctrl+Z)" disabled={past.current.length === 0}>↶</button>
            <button type="button" style={smallBtn} onClick={redo} title="Rehacer (Ctrl+Y)" disabled={future.current.length === 0}>↷</button>
            <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.1)" }} />
            <button
              type="button" style={showOriginal ? smallBtnActive : smallBtn}
              onPointerDown={() => setShowOriginal(true)} onPointerUp={() => setShowOriginal(false)}
              onPointerLeave={() => setShowOriginal(false)}
              title="Mantén pulsado para ver el ORIGINAL (sin receta, con la misma geometría)"
            >Ver original</button>
            <button type="button" style={split != null ? smallBtnActive : smallBtn}
              onClick={() => setSplit(s => (s == null ? 0.5 : null))}
              title="Antes / Después con línea divisoria">Antes/Después</button>
            <div style={{ flex: 1 }} />
            <span style={{ ...muted, fontFamily: "monospace" }}>{Math.round(view.zoom * 100)}%</span>
            <button type="button" style={smallBtn} onClick={() => setView(v => ({ ...v, zoom: clamp(v.zoom * 0.85, 0.2, 12) }))}>−</button>
            <button type="button" style={smallBtn} onClick={() => setView({ zoom: 1, panX: 0, panY: 0 })} title="Ajustar (0)">Fit</button>
            <button type="button" style={smallBtn} onClick={() => setView(v => ({ ...v, zoom: clamp(v.zoom * 1.18, 0.2, 12) }))}>+</button>
            <button type="button" style={{ ...smallBtn, padding: "4px 12px" }} onClick={onClose}>← Volver al diseño</button>
          </div>

          {/* Stage */}
          <div
            ref={stageRef}
            onPointerDown={stagePointerDown}
            onPointerMove={stagePointerMove}
            onPointerUp={stagePointerUp}
            onWheel={e => { e.preventDefault(); const k = Math.exp(-e.deltaY * (e.altKey ? 0.0024 : 0.0012)); setView(v => ({ ...v, zoom: clamp(v.zoom * k, 0.2, 12) })); }}
            style={{ flex: 1, position: "relative", overflow: "hidden", background: "#131313", cursor: mode === "brush" || isPaintTool(tool) || tool === "marquee" || tool === "lasso" || tool === "quicksel" || tool === "eyedropper" ? "crosshair" : tool === "zoom" ? "zoom-in" : tool === "hand" ? "grab" : mode === "crop" ? "default" : "grab", touchAction: "none" }}
          >
            {/* F4.2d: cursor circular del pincel (diámetro real, se mueve por ref sin re-render) */}
            <div ref={brushCursorRef} style={{ display: "none", position: "absolute", border: "1px solid rgba(255,255,255,0.85)", outline: "1px solid rgba(0,0,0,0.5)", borderRadius: "50%", pointerEvents: "none", zIndex: 4 }} />
            <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />

            {/* Fase 4: stack de capas — DOM sobre el visor WebGL. Los canvas son
                espejos de los masters offscreen (sync por efecto + tick);
                mix-blend-mode soporta los 16 blends de COMPOSITION_BLENDS. */}
            {mode === "compose" && !glError && !loadError && imgRect.width > 0 && (
              <div style={{
                position: "absolute", left: imgRect.left, top: imgRect.top,
                width: imgRect.width, height: imgRect.height, pointerEvents: "none",
                outline: activeComposeLayer ? "1px dashed rgba(200,184,152,0.5)" : "none",
              }}>
                {composeLayers.filter(l => l.visible).map(l => (
                  <canvas
                    key={l.id}
                    ref={el => { if (el) mirrorCanvasesRef.current.set(l.id, el); else mirrorCanvasesRef.current.delete(l.id); }}
                    style={{
                      position: "absolute", inset: 0, width: "100%", height: "100%",
                      mixBlendMode: l.blend as React.CSSProperties["mixBlendMode"],
                      opacity: l.opacity,
                      // F4.2d: previsualización EN VIVO de la transformación libre
                      transform: (() => {
                        const t = activeLayerId === l.id && tfDraft ? tfDraft : l.transform;
                        return `translate(${t.x * 100}%, ${t.y * 100}%) rotate(${t.rotation}deg) scale(${t.scale})`;
                      })(),
                    }}
                  />
                ))}
              </div>
            )}

            {/* F4.2e: overlay de la máscara rápida (Q) */}
            {qmask && !glError && !loadError && imgRect.width > 0 && (
              <canvas ref={qmaskMirrorRef}
                style={{ position: "absolute", left: imgRect.left, top: imgRect.top, width: imgRect.width, height: imgRect.height, pointerEvents: "none", zIndex: 2, opacity: 0.8 }} />
            )}

            {/* F4.2e: barra de estado del stage (zoom · dimensiones · herramienta) */}
            {!glError && (
              <div style={{ position: "absolute", left: 8, bottom: 8, zIndex: 3, display: "flex", gap: 10, alignItems: "center", fontSize: 9, fontFamily: "monospace", color: "#8a8378", background: "rgba(13,13,13,0.88)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 4, padding: "3px 8px", pointerEvents: "none" }}>
                <span>{Math.round(view.zoom * 100)}%</span>
                {imgDims && <span>{outSize.w}×{outSize.h}px</span>}
                <span>{GROUP_BY_ID.get(tool)?.label || tool}{toolVariant ? ` · ${findVariant(tool, toolVariant)?.label.replace(/\s*\(.*$/, "") || toolVariant}` : ""}</span>
                {qmask && <span style={{ color: "#e08a8a" }}>MÁSCARA RÁPIDA</span>}
                {maskEditId && <span style={{ color: "#d8b08a" }}>PINTANDO MÁSCARA</span>}
              </div>
            )}

            {/* Fase 4.2c: selección/borradores (hormigas simplificadas sobre el stage) */}
            {!glError && !loadError && imgRect.width > 0 && (selPreview || selectionBBox || penPts.length > 0 || typeDraft) && (
              <svg width={imgRect.width} height={imgRect.height}
                style={{ position: "absolute", left: imgRect.left, top: imgRect.top, pointerEvents: "none", zIndex: 2 }}>
                {selPreview?.kind === "rect" && (
                  <rect x={selPreview.x * imgRect.width} y={selPreview.y * imgRect.height}
                    width={selPreview.w * imgRect.width} height={selPreview.h * imgRect.height}
                    fill="none" stroke="#f0ebe0" strokeWidth={1} strokeDasharray="5 4">
                    <animate attributeName="stroke-dashoffset" from="0" to="-9" dur="0.6s" repeatCount="indefinite" />
                  </rect>
                )}
                {selPreview?.kind === "ellipse" && (
                  <ellipse cx={(selPreview.x + selPreview.w / 2) * imgRect.width} cy={(selPreview.y + selPreview.h / 2) * imgRect.height}
                    rx={Math.max(1, (selPreview.w / 2) * imgRect.width)} ry={Math.max(1, (selPreview.h / 2) * imgRect.height)}
                    fill="none" stroke="#f0ebe0" strokeWidth={1} strokeDasharray="5 4">
                    <animate attributeName="stroke-dashoffset" from="0" to="-9" dur="0.6s" repeatCount="indefinite" />
                  </ellipse>
                )}
                {selPreview?.kind === "poly" && (
                  <polyline points={selPreview.pts.map(([px, py]) => `${px * imgRect.width},${py * imgRect.height}`).join(" ")}
                    fill="none" stroke="#f0ebe0" strokeWidth={1} strokeDasharray="5 4">
                    <animate attributeName="stroke-dashoffset" from="0" to="-9" dur="0.6s" repeatCount="indefinite" />
                  </polyline>
                )}
                {selPreview?.kind === "line" && (
                  <line x1={selPreview.x1 * imgRect.width} y1={selPreview.y1 * imgRect.height}
                    x2={selPreview.x2 * imgRect.width} y2={selPreview.y2 * imgRect.height}
                    stroke="#f0ebe0" strokeWidth={1} strokeDasharray="5 4" />
                )}
                {!selPreview && selectionBBox && (
                  <rect x={selectionBBox.x * imgRect.width} y={selectionBBox.y * imgRect.height}
                    width={selectionBBox.w * imgRect.width} height={selectionBBox.h * imgRect.height}
                    fill="none" stroke="#f0ebe0" strokeWidth={1} strokeDasharray="5 4">
                    <animate attributeName="stroke-dashoffset" from="0" to="-9" dur="0.6s" repeatCount="indefinite" />
                  </rect>
                )}
                {penPts.length > 0 && (
                  <>
                    <polyline points={penPts.map(([px, py]) => `${px * imgRect.width},${py * imgRect.height}`).join(" ")}
                      fill="none" stroke="#c8b898" strokeWidth={1.2} />
                    {penPts.map(([px, py], i) => (
                      <rect key={i} x={px * imgRect.width - 2.5} y={py * imgRect.height - 2.5} width={5} height={5} fill="#c8b898" />
                    ))}
                  </>
                )}
                {typeDraft && (
                  <line x1={typeDraft.x * imgRect.width} y1={(typeDraft.y - 0.025) * imgRect.height}
                    x2={typeDraft.x * imgRect.width} y2={typeDraft.y * imgRect.height}
                    stroke="#c8b898" strokeWidth={2} />
                )}
              </svg>
            )}

            {/* F4.2d: manijas de transformación libre (escala/rotación desde el centro,
             * con previsualización en vivo en el espejo de la capa activa) */}
            {tfDraft && mode === "compose" && !glError && !loadError && (
              <>
                <div style={{ position: "absolute", left: imgRect.left, top: imgRect.top, width: imgRect.width, height: imgRect.height, border: "1.5px dashed #c8b898", pointerEvents: "none", zIndex: 2 }} />
                {(["nw", "ne", "sw", "se"] as const).map(corner => (
                  <div key={corner}
                    onPointerDown={e => { e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag.current = { kind: "tf-drag", startX: e.clientX, startY: e.clientY, base: { ...tfDraft }, corner }; }}
                    style={{ position: "absolute", width: 11, height: 11, borderRadius: 2, background: "#c8b898", cursor: "nwse-resize", zIndex: 3,
                      left: (corner.includes("w") ? imgRect.left : imgRect.left + imgRect.width) - 5,
                      top: (corner.includes("n") ? imgRect.top : imgRect.top + imgRect.height) - 5 }} />
                ))}
                <div
                  onPointerDown={e => { e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag.current = { kind: "tf-drag", startX: e.clientX, startY: e.clientY, base: { ...tfDraft }, corner: "rot" }; }}
                  title="Arrastra para rotar"
                  style={{ position: "absolute", width: 12, height: 12, borderRadius: "50%", background: "#e0d6c0", cursor: "grab", zIndex: 3,
                    left: imgRect.left + imgRect.width / 2 - 6, top: imgRect.top - 20 }} />
              </>
            )}

            {/* Fase 4.2c: barra de opciones contextual (grupo + variante activa) */}
            {!glError && !loadError && (() => {
              const grp = GROUP_BY_ID.get(tool);
              const vdef = findVariant(tool, toolVariant);
              return (
                <div
                  data-testid="photo-options-bar"
                  onPointerDown={e => e.stopPropagation()}
                  style={{ position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", maxWidth: "92%", display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, padding: "5px 9px", borderRadius: 6, background: "rgba(13,13,13,0.92)", border: "1px solid rgba(255,255,255,0.09)", zIndex: 3 }}
                >
                  <span style={{ fontSize: 10, fontWeight: 600, color: "#c8b898" }}>
                    {grp?.label || tool}{grp && grp.variants.length > 1 && vdef ? ` · ${vdef.label.replace(/\s*\(.*$/, "")}` : ""}
                  </span>
                  <div style={{ width: 1, height: 14, background: "rgba(255,255,255,0.1)" }} />
                  {SIZE_GROUPS.has(tool) && (
                    <label style={{ fontSize: 9, color: "#8a8378", display: "flex", alignItems: "center", gap: 4 }}>
                      Tamaño
                      <input type="range" min={1} max={400} value={paintSize} onChange={e => setPaintSize(Number(e.target.value))}
                        title="Tamaño del trazo ([ y ] lo ajustan)" style={{ width: 64, accentColor: "#c8b898" }} />
                      <span style={{ fontFamily: "monospace", width: 16 }}>{paintSize}</span>
                    </label>
                  )}
                  {OPACITY_GROUPS.has(tool) && (
                    <label style={{ fontSize: 9, color: "#8a8378", display: "flex", alignItems: "center", gap: 4 }}>
                      Opacidad
                      <input type="range" min={5} max={100} value={Math.round(paintOpacity * 100)} onChange={e => setPaintOpacity(Number(e.target.value) / 100)}
                        style={{ width: 56, accentColor: "#c8b898" }} />
                      <span style={{ fontFamily: "monospace", width: 22 }}>{Math.round(paintOpacity * 100)}%</span>
                    </label>
                  )}
                  {FLOW_GROUPS.has(tool) && (
                    <label style={{ fontSize: 9, color: "#8a8378", display: "flex", alignItems: "center", gap: 4 }}>
                      Flujo
                      <input type="range" min={5} max={100} value={Math.round(paintFlow * 100)} onChange={e => setPaintFlow(Number(e.target.value) / 100)}
                        title="Flujo: acumulación de tinta dentro del trazo" style={{ width: 56, accentColor: "#c8b898" }} />
                      <span style={{ fontFamily: "monospace", width: 22 }}>{Math.round(paintFlow * 100)}%</span>
                    </label>
                  )}
                  {SMOOTH_GROUPS.has(tool) && (
                    <label style={{ fontSize: 9, color: "#8a8378", display: "flex", alignItems: "center", gap: 4 }}>
                      Suavizar
                      <input type="range" min={0} max={80} value={paintSmooth} onChange={e => setPaintSmooth(Number(e.target.value))}
                        title="El trazo persigue al puntero (menos temblor)" style={{ width: 56, accentColor: "#c8b898" }} />
                      <span style={{ fontFamily: "monospace", width: 22 }}>{paintSmooth}%</span>
                    </label>
                  )}
                  {COLOR_GROUPS.has(tool) && (
                    <input type="color" value={paintColor} onChange={e => setPaintColor(e.target.value)} title="Color de primer plano"
                      style={{ width: 24, height: 20, padding: 0, border: "1px solid rgba(255,255,255,0.15)", borderRadius: 3, background: "transparent", cursor: "pointer" }} />
                  )}
                  {(tool === "marquee" || tool === "lasso" || tool === "quicksel") && (
                    <label style={{ fontSize: 9, color: "#8a8378", display: "flex", alignItems: "center", gap: 4 }}>
                      Difuminar
                      <input type="range" min={0} max={50} value={selFeather} onChange={e => setSelFeather(Number(e.target.value))}
                        title="Feather: difumina el borde de la selección al confirmarla" style={{ width: 56, accentColor: "#c8b898" }} />
                      <span style={{ fontFamily: "monospace", width: 18 }}>{selFeather}</span>
                    </label>
                  )}
                  {tool === "brush" && (
                    <label style={{ fontSize: 9, color: "#8a8378", display: "flex", alignItems: "center", gap: 4 }}>
                      Dureza
                      <input type="range" min={0} max={100} value={paintHardness} onChange={e => setPaintHardness(Number(e.target.value))}
                        title="Dureza de la punta (0 = muy suave, 100 = casi sólida)" style={{ width: 56, accentColor: "#c8b898" }} />
                      <span style={{ fontFamily: "monospace", width: 22 }}>{paintHardness}%</span>
                    </label>
                  )}
                  {(tool === "quicksel" || (tool === "eraser" && toolVariant === "magic")) && (
                    <label style={{ fontSize: 9, color: "#8a8378", display: "flex", alignItems: "center", gap: 4 }}>
                      Tolerancia
                      <input type="range" min={4} max={120} value={wandTolerance} onChange={e => setWandTolerance(Number(e.target.value))}
                        style={{ width: 64, accentColor: "#c8b898" }} />
                      <span style={{ fontFamily: "monospace", width: 16 }}>{wandTolerance}</span>
                    </label>
                  )}
                  {tool === "shapes" && toolVariant === "polygon" && (
                    <label style={{ fontSize: 9, color: "#8a8378", display: "flex", alignItems: "center", gap: 4 }}>
                      Lados
                      <input type="number" min={3} max={20} value={shapeSides}
                        onChange={e => setShapeSides(Math.max(3, Math.min(20, Number(e.target.value) || 6)))}
                        style={{ width: 40, background: "#191919", color: "#e0d6c0", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 3, fontSize: 10, padding: "2px 4px" }} />
                    </label>
                  )}
                  {tool === "shapes" && toolVariant === "custom" && (
                    <select value={customShapeId} onChange={e => setCustomShapeId(e.target.value)} title="Forma personalizada"
                      style={{ fontSize: 10, background: "#191919", color: "#e0d6c0", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 3, padding: "2px 4px", cursor: "pointer" }}>
                      <option value="estrella">Estrella</option>
                      <option value="corazon">Corazón</option>
                      <option value="flecha">Flecha</option>
                      <option value="rayo">Rayo</option>
                      <option value="gota">Gota</option>
                    </select>
                  )}
                  {tool === "clone" && toolVariant === "pattern" && (
                    <>
                      <select value={patternKind} onChange={e => { setPatternKind(e.target.value); patternTileRef.current = null; }} title="Patrón del tampón"
                        style={{ fontSize: 10, background: "#191919", color: "#e0d6c0", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 3, padding: "2px 4px", cursor: "pointer" }}>
                        <option value="cuadros">Cuadros</option>
                        <option value="puntos">Puntos</option>
                        <option value="diagonal">Diagonal</option>
                        <option value="ruido">Ruido</option>
                      </select>
                      <label style={{ fontSize: 9, color: "#8a8378", display: "flex", alignItems: "center", gap: 4 }}>
                        Tesela
                        <input type="range" min={8} max={80} value={patternTile} onChange={e => { setPatternTile(Number(e.target.value)); patternTileRef.current = null; }}
                          title="Tamaño de la tesela del patrón" style={{ width: 56, accentColor: "#c8b898" }} />
                        <span style={{ fontFamily: "monospace", width: 18 }}>{patternTile}</span>
                      </label>
                    </>
                  )}
                  {tool === "type" && (
                    <>
                      <select value={typeFont} onChange={e => setTypeFont(e.target.value)}
                        title="Fuente del texto (fuentes del sistema)"
                        style={{ fontSize: 10, background: "#191919", color: "#e0d6c0", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 3, padding: "2px 4px", cursor: "pointer" }}>
                        <option value="Inter, system-ui, sans-serif">Inter</option>
                        <option value="Georgia, serif">Georgia</option>
                        <option value="Arial, Helvetica, sans-serif">Arial</option>
                        <option value="'Times New Roman', serif">Times</option>
                        <option value="'Courier New', monospace">Courier</option>
                        <option value="Impact, sans-serif">Impact</option>
                      </select>
                      <label style={{ fontSize: 9, color: "#8a8378", display: "flex", alignItems: "center", gap: 4 }}>
                        Cuerpo
                        <input type="number" min={8} max={400} value={typeSize}
                          onChange={e => setTypeSize(Math.max(8, Math.min(400, Number(e.target.value) || 48)))}
                          style={{ width: 52, background: "#191919", color: "#e0d6c0", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 3, fontSize: 10, padding: "2px 4px" }} />
                      </label>
                      <label style={{ fontSize: 9, color: "#8a8378", display: "flex", alignItems: "center", gap: 3 }} title="Texto vertical (rotado 90° por línea)">
                        <input type="checkbox" checked={typeVertical || toolVariant === "typevert"} onChange={e => setTypeVertical(e.target.checked)} /> Vertical
                      </label>
                      {typeDraft ? (
                        <>
                          <input autoFocus type="text" value={typeDraft.value} placeholder="Escribe y pulsa Enter…"
                            onChange={e => setTypeDraft(d => (d ? { ...d, value: e.target.value } : d))}
                            onKeyDown={e => {
                              if (e.key === "Enter") { e.preventDefault(); commitType(); }
                              if (e.key === "Escape") setTypeDraft(null);
                            }}
                            style={{ width: 180, background: "#191919", color: "#e0d6c0", border: "1px solid rgba(200,184,152,0.35)", borderRadius: 3, fontSize: 11, padding: "3px 6px" }} />
                          <button type="button" style={smallBtn} onClick={commitType}>Aplicar texto (Enter)</button>
                          <button type="button" style={smallBtn} onClick={() => setTypeDraft(null)}>Cancelar (Esc)</button>
                        </>
                      ) : (
                        <span style={muted}>clic sobre la foto para colocar el texto</span>
                      )}
                    </>
                  )}
                  {tool === "pen" && (
                    <>
                      {toolVariant === "freeform"
                        ? <span style={muted}>arrastra para dibujar a mano alzada · al soltar se cierra el trazado</span>
                        : <span style={muted}>clic: puntos · Enter: cerrar y trazar · Esc: cancelar</span>}
                      {penPts.length >= 3 && <button type="button" style={smallBtn} onClick={closePenPath}>Cerrar trazado (Enter)</button>}
                    </>
                  )}
                  {tool === "lasso" && toolVariant === "poly" && <span style={muted}>clic: puntos · Enter: cierra la selección</span>}
                  {tool === "marquee" && (toolVariant === "row" || toolVariant === "col") && <span style={muted}>clic: selecciona la fila/columna de 1 px</span>}
                  {tool === "gradient" && toolVariant !== "bucket" && <span style={muted}>arrastra el vector (color → transparente) · respeta la selección</span>}
                  {tool === "clone" && toolVariant !== "pattern" && <span style={muted}>Alt+clic: definir origen</span>}
                  {tool === "clone" && toolVariant === "pattern" && <span style={muted}>estampa el patrón elegido — no necesita origen</span>}
                  {tool === "quicksel" && toolVariant === "quick" && <span style={muted}>{samBusy ? "SAM analizando…" : "clic: objeto bajo el puntero (SAM) · Shift añade · Alt resta"}</span>}
                  {tool === "heal" && toolVariant === "patch" && <span style={muted}>requiere selección · arrastra hacia la zona fuente</span>}
                  {tool === "heal" && (toolVariant === "spot" || toolVariant === "heal") && <span style={muted}>v1: remuestreo difuminado del entorno</span>}
                  {tool === "heal" && toolVariant === "redeye" && <span style={muted}>pinta sobre el iris — v1 dessatura la zona (Alt no aplica)</span>}
                  {tool === "history" && <span style={muted}>pinta el revelado base (la foto sin capas de pintura)</span>}
                  {tool === "dodge" && toolVariant === "sponge" && <span style={muted}>Alt: desaturar en vez de saturar</span>}
                  {tool === "blur" && toolVariant === "smudge" && <span style={muted}>dedo: arrastra el contenido de la capa</span>}
                  {toolNotice && <span style={{ fontSize: 9, color: "#d8b08a" }}>{toolNotice}</span>}
                  {selectionBBox && (
                    <>
                      <span style={{ fontSize: 9, color: "#9fd0a0" }}>Selección activa</span>
                      <button type="button" style={smallBtn} onClick={() => invertSelection()} title="Invertir (Ctrl+Shift+I)">Invertir</button>
                      <button type="button" style={smallBtn} onClick={clearSelection}>Deseleccionar</button>
                      <button type="button" style={smallBtn} onClick={saveSelectionSlot} title="Guarda la selección actual en un slot">Guardar sel.</button>
                      <button type="button" style={smallBtn} disabled={!hasSavedSel} onClick={loadSelectionSlot} title="Restaura la selección guardada">Cargar sel.</button>
                    </>
                  )}
                  {mode === "compose" && (
                    <>
                      <div style={{ width: 1, height: 14, background: "rgba(255,255,255,0.1)" }} />
                      <button type="button" style={smallBtn} onClick={composeUndo} title="Deshacer la composición (Ctrl+Z)">Deshacer</button>
                      <button type="button" style={smallBtn} onClick={composeRedo} title="Rehacer (Ctrl+Y)">Rehacer</button>
                      {activeComposeLayer && !tfDraft && <button type="button" style={smallBtn} onClick={enterTfDraft} title="Transformación libre (Ctrl+T)">Transformar</button>}
                      {activeComposeLayer && !tfDraft && <button type="button" style={smallBtn} onClick={() => composeDuplicateLayer(activeComposeLayer.id)} title="Duplicar capa (Ctrl+J)">Duplicar</button>}
                      {activeComposeLayer && !tfDraft && <button type="button" style={smallBtn} onClick={() => composeMergeDown(activeComposeLayer.id)} title="Fusionar hacia abajo (Ctrl+E)">Fusionar</button>}
                      <button type="button" style={smallBtn} onClick={composeFlattenLayers} title="Aplanar imagen (Ctrl+Shift+E)">Aplanar</button>
                      {tfDraft && (
                        <>
                          <span style={{ fontSize: 9, color: "#c8b898", fontFamily: "monospace" }}>{tfDraft.scale.toFixed(2)}× · {Math.round(tfDraft.rotation)}°</span>
                          <button type="button" style={smallBtnActive} onClick={commitTfDraft}>Aplicar (Enter)</button>
                          <button type="button" style={smallBtn} onClick={() => setTfDraft(null)}>Cancelar (Esc)</button>
                        </>
                      )}
                      {maskEditId && <span style={{ fontSize: 9, color: "#d8b08a" }}>· pintando MÁSCARA de «{composeLayers.find(l => l.id === maskEditId)?.name || "?"}» (trazo oculta · Alt revela)</span>}
                    </>
                  )}
                  {mode === "compose" && activeComposeLayer && <span style={{ fontSize: 9, color: "#8a8378" }}>· {activeComposeLayer.name}</span>}
                </div>
              );
            })()}
            {glError && (
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" }}>
                <div style={{ maxWidth: 380 }}>
                  <div style={{ color: "#e0d6c0", fontSize: 13, marginBottom: 8 }}>{glError}</div>
                  <button type="button" style={smallBtn} onClick={onClose}>← Volver al diseño</button>
                </div>
              </div>
            )}
            {loadError && !glError && (
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
                <div style={{ maxWidth: 380, textAlign: "center" }}>
                  <div style={{ color: "#e0d6c0", fontSize: 13, marginBottom: 6 }}>No se pudo abrir la foto</div>
                  <div style={muted}>El origen de la imagen no permite leerla desde el navegador (CORS) o la URL dejó de responder. Puedes crear una copia editable en Assets y revelar esa copia — el diseño no se toca.</div>
                  <button type="button" style={{ ...smallBtn, marginTop: 10 }} disabled={creatingCopy} onClick={handleCreateEditableCopy}>
                    {creatingCopy ? "Copiando…" : "Crear copia editable"}
                  </button>
                </div>
              </div>
            )}

            {/* crop overlay */}
            {mode === "crop" && !loadError && !glError && (
              <>
                <div style={{ position: "absolute", pointerEvents: "none", inset: 0, background: "rgba(0,0,0,0.55)" }} />
                <div style={{
                  position: "absolute", pointerEvents: "none",
                  left: imgRect.left + cropDraft.x * imgRect.width,
                  top: imgRect.top + cropDraft.y * imgRect.height,
                  width: cropDraft.w * imgRect.width, height: cropDraft.h * imgRect.height,
                  border: "1.5px solid #c8b898", boxShadow: "0 0 0 9999px rgba(0,0,0,0)",
                  background: "transparent",
                  outline: "9999px solid transparent",
                }} />
                {/* el área externa al rect se oscurece con 4 tapas */}
                {([
                  ["top", imgRect.left, imgRect.top, imgRect.width, cropDraft.y * imgRect.height],
                  ["bottom", imgRect.left, imgRect.top + (cropDraft.y + cropDraft.h) * imgRect.height, imgRect.width, Math.max(0, imgRect.height - (cropDraft.y + cropDraft.h) * imgRect.height)],
                  ["left", imgRect.left, imgRect.top + cropDraft.y * imgRect.height, cropDraft.x * imgRect.width, cropDraft.h * imgRect.height],
                  ["right", imgRect.left + (cropDraft.x + cropDraft.w) * imgRect.width, imgRect.top + cropDraft.y * imgRect.height, Math.max(0, imgRect.width - (cropDraft.x + cropDraft.w) * imgRect.width), cropDraft.h * imgRect.height],
                ] as const).map(([key, l, t, w, h]) => (
                  <div key={key} style={{ position: "absolute", left: l, top: t, width: w, height: h, background: "rgba(10,10,10,0.62)", pointerEvents: "none" }} />
                ))}
                {/* handles */}
                {(["nw", "ne", "sw", "se"] as const).map(corner => {
                  const hx = corner.includes("w") ? cropDraft.x : cropDraft.x + cropDraft.w;
                  const hy = corner.includes("n") ? cropDraft.y : cropDraft.y + cropDraft.h;
                  return (
                    <div key={corner} style={{
                      position: "absolute", width: 10, height: 10, borderRadius: 2, background: "#c8b898",
                      left: imgRect.left + hx * imgRect.width - 5, top: imgRect.top + hy * imgRect.height - 5,
                      pointerEvents: "none",
                    }} />
                  );
                })}
                <div style={{ position: "absolute", left: imgRect.left, top: imgRect.top + imgRect.height + 8, display: "flex", gap: 6 }}>
                  {([["Libre", null], ["1:1", 1], ["4:5", 4 / 5], ["16:9", 16 / 9], ["9:16", 9 / 16]] as const).map(([label, r]) => (
                    <button key={label} type="button" style={aspect === r ? smallBtnActive : smallBtn}
                      onClick={() => applyAspect(r as number | null)}>{label}</button>
                  ))}
                  <button type="button" style={smallBtn} onClick={() => mutateRecipe(r => { r.geometry.rotate90 = ((r.geometry.rotate90 + 1) % 4) as GeometryParams["rotate90"]; })}>⟳ 90°</button>
                  <button type="button" style={smallBtn} onClick={() => mutateRecipe(r => { r.geometry.flipH = !r.geometry.flipH; })}>⇋ H</button>
                  <button type="button" style={smallBtn} onClick={() => mutateRecipe(r => { r.geometry.flipV = !r.geometry.flipV; })}>⇅ V</button>
                  <button type="button" style={{ ...smallBtn, background: "rgba(99,102,241,0.25)", borderColor: "rgba(99,102,241,0.5)", color: "#c7d2fe" }}
                    onClick={() => {
                      mutateRecipe(r => { r.geometry.crop = displayRectToSourceRect(cropDraft, r.geometry); });
                      setMode("edit");
                    }}>Aplicar recorte</button>
                </div>
              </>
            )}

            {/* split divider */}
            {split != null && mode === "edit" && !glError && (
              <div style={{ position: "absolute", left: `${split * 100}%`, top: 0, bottom: 0, width: 2, background: "#c8b898", cursor: "ew-resize" }}>
                <div style={{ position: "absolute", top: 8, left: -1, fontSize: 9, color: "#0a0a0a", background: "#c8b898", padding: "1px 5px", borderRadius: 3, whiteSpace: "nowrap" }}>◀ antes | después ▶</div>
              </div>
            )}
          </div>

          {/* Barra de salida (REQ §5) */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderTop: "1px solid rgba(255,255,255,0.06)", background: "#0d0d0d" }}>
            <button type="button" style={{ ...smallBtn, background: "rgba(99,102,241,0.3)", borderColor: "rgba(99,102,241,0.55)", color: "#e0e7ff", padding: "5px 12px", fontWeight: 600 }}
              disabled={busy || !active} onClick={handleApplyToLayer} title="Crea la variante y reemplaza SOLO esta capa. El original queda en data-orig-src.">
              {busy ? "Procesando…" : "Aplicar a la capa"}
            </button>
            {instanceCount > 1 && (
              <button type="button" style={smallBtn} disabled={busy} onClick={handleApplyToAll}
                title="Requiere confirmación explícita (REQ §2)">
                Aplicar a las {instanceCount} instancias
              </button>
            )}
            <button type="button" style={smallBtn} disabled={busy} onClick={handleSaveRecipe} title="Guarda la receta como versión sin tocar el diseño">Guardar receta</button>
            <button type="button" style={smallBtn} disabled={busy} onClick={handleExportPng} title="Exporta el revelado a PNG sin alterar el diseño">Exportar PNG</button>
            <div style={{ flex: 1 }} />
            {edited && <span style={muted}>receta con cambios — nada se aplica hasta que decidas</span>}
            <button type="button" style={smallBtn} onClick={onClose}>Cerrar sin aplicar</button>
          </div>
        </div>

        {/* ── Derecha: inspector ── */}
        <div style={{ flex: "0 0 268px", borderLeft: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", minHeight: 0, background: "#0d0d0d" }}>
          {mode !== "compose" && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3, padding: "7px 8px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              {(["luz", "color", "detalle", "efectos", "mascaras", "recetas"] as PhotoTab[]).map(t => (
                <button key={t} type="button" style={tab === t ? smallBtnActive : smallBtn} onClick={() => setTab(t)}>
                  {t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          )}
          {mode === "compose" ? (
            <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px", display: "flex", flexDirection: "column" }}>
              <PhotoComposePanel
                layers={composeLayers}
                activeId={activeLayerId}
                saving={composeSaving}
                dirty={composeDirty}
                onSelect={setActiveLayerId}
                onPatch={composePatchLayer}
                onMove={composeMoveLayer}
                onAdd={composeAddLayer}
                onDelete={composeDeleteLayer}
                onSave={saveComposition}
              />
              {mode === "compose" && (
                <div style={{ marginBottom: 10 }}>
                  <Group title={`Historial de la composición (${composePast.current.length})`}>
                    <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
                      <button type="button" style={smallBtn} onClick={composeUndo}>Deshacer (Ctrl+Z)</button>
                      <button type="button" style={smallBtn} onClick={composeRedo}>Rehacer (Ctrl+Y)</button>
                    </div>
                    {/* F4.2e: saltos directos a pasos anteriores */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <button type="button" style={{ ...smallBtn, textAlign: "left", cursor: "default" }}>● Estado actual</button>
                      {[...composePast.current].map((s, i) => ({ s, i })).reverse().map(({ s, i }) => (
                        <button key={`${i}:${s.label}`} type="button" style={{ ...smallBtn, textAlign: "left" }}
                          title="Salta a este paso (deshace en cadena)"
                          onClick={() => jumpComposeHistory(i)}>
                          {i + 1}. {s.label || "Paso"}
                        </button>
                      ))}
                    </div>
                  </Group>
                  {activeComposeLayer && !layerMasksRef.current.has(activeComposeLayer.id) && (
                    <button type="button" style={smallBtn} onClick={() => { pushComposeHistory(true); ensureLayerMask(activeComposeLayer.id); setComposeTick(t => t + 1); addToast(`Máscara añadida a «${activeComposeLayer.name}» (viva en la sesión — la exportación la respeta al aplanar; Guardar también la persiste).`, "info"); }}>
                      + Añadir máscara de capa
                    </button>
                  )}
                  {activeComposeLayer && layerMasksRef.current.has(activeComposeLayer.id) && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      <button type="button" style={maskEditId === activeComposeLayer.id ? smallBtnActive : smallBtn}
                        onClick={() => setMaskEditId(m => (m === activeComposeLayer.id ? null : activeComposeLayer.id))}
                        title="Las tools de pintura escriben la máscara: trazo normal oculta · Alt revela">
                        {maskEditId === activeComposeLayer.id ? "Pintando máscara…" : "Pintar máscara"}
                      </button>
                      <button type="button" style={smallBtn}
                        onClick={() => { pushComposeHistory(); layerMasksRef.current.delete(activeComposeLayer.id); if (maskEditId === activeComposeLayer.id) setMaskEditId(null); setComposeTick(t => t + 1); }}>
                        Quitar máscara
                      </button>
                    </div>
                  )}
                  {activeComposeLayer && (
                    <Group title="Filtros (respeta la selección)">
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        <button type="button" style={smallBtn} onClick={() => applyLayerFilter("gauss")}>Gaussiano</button>
                        <button type="button" style={smallBtn} onClick={() => applyLayerFilter("noise")}>Ruido</button>
                        <button type="button" style={smallBtn} onClick={() => applyLayerFilter("mosaic")}>Mosaico</button>
                        <button type="button" style={smallBtn} onClick={() => applyLayerFilter("highpass")}>Paso alto</button>
                        <button type="button" style={smallBtn} onClick={() => applyLayerFilter("clouds")}>Nubes</button>
                      </div>
                      <div style={{ ...muted, marginTop: 4 }}>Intensidad = Tamaño del pincel ({paintSize}).</div>
                    </Group>
                  )}
                  {activeComposeLayer && (
                    <Group title="Ajustes de capa (no destructivos)">
                      {(() => {
                        const adj = activeComposeLayer.adjust || { brightness: 1, contrast: 1, saturation: 1, hue: 0 };
                        const lid = activeComposeLayer.id;
                        const patchAdj = (p: Partial<CompositionLayerAdjust>) => composePatchLayer(lid, { adjust: { ...adj, ...p } });
                        return (
                          <>
                            <Slider label="Brillo" value={adj.brightness} min={0.2} max={3} step={0.01} def={1} onChange={v => patchAdj({ brightness: v })} />
                            <Slider label="Contraste" value={adj.contrast} min={0.2} max={3} step={0.01} def={1} onChange={v => patchAdj({ contrast: v })} />
                            <Slider label="Saturación" value={adj.saturation} min={0} max={3} step={0.01} def={1} onChange={v => patchAdj({ saturation: v })} />
                            <Slider label="Matiz (°)" value={adj.hue} min={-180} max={180} step={1} def={0} onChange={v => patchAdj({ hue: v })} />
                          </>
                        );
                      })()}
                    </Group>
                  )}
                </div>
              )}
              {activeComposeLayer && (
                <div style={{ marginTop: 10 }}>
                  <Group title="Transformar capa">
                    <Slider label="Escala" value={activeComposeLayer.transform.scale} min={0.1} max={3} step={0.01}
                      onChange={v => composePatchTransform({ scale: v })} />
                    <Slider label="Rotación (°)" value={activeComposeLayer.transform.rotation} min={-180} max={180} step={1}
                      onChange={v => composePatchTransform({ rotation: v })} />
                    <Slider label="Offset X" value={activeComposeLayer.transform.x} min={-1} max={1} step={0.005}
                      onChange={v => composePatchTransform({ x: v })} />
                    <Slider label="Offset Y" value={activeComposeLayer.transform.y} min={-1} max={1} step={0.005}
                      onChange={v => composePatchTransform({ y: v })} />
                  </Group>
                </div>
              )}
            </div>
          ) : (
          <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px" }}>
            {tab === "luz" && (
              <>
                <Group title="Tono (basic)">
                  <Slider label="Exposure" value={opOf(recipe, "basic").exposure} min={-100} max={100} onChange={v => setOp("basic", { exposure: v })} onCommitStart={snapshotForUndo} />
                  <Slider label="Contrast" value={opOf(recipe, "basic").contrast} min={-100} max={100} onChange={v => setOp("basic", { contrast: v })} onCommitStart={snapshotForUndo} />
                  <Slider label="Highlights" value={opOf(recipe, "basic").highlights} min={-100} max={100} onChange={v => setOp("basic", { highlights: v })} onCommitStart={snapshotForUndo} />
                  <Slider label="Shadows" value={opOf(recipe, "basic").shadows} min={-100} max={100} onChange={v => setOp("basic", { shadows: v })} onCommitStart={snapshotForUndo} />
                  <Slider label="Whites" value={opOf(recipe, "basic").whites} min={-100} max={100} onChange={v => setOp("basic", { whites: v })} onCommitStart={snapshotForUndo} />
                  <Slider label="Blacks" value={opOf(recipe, "basic").blacks} min={-100} max={100} onChange={v => setOp("basic", { blacks: v })} onCommitStart={snapshotForUndo} />
                </Group>
                <Group title="Balance de blancos">
                  <Slider label="Temperatura" value={opOf(recipe, "white_balance").temp} min={-100} max={100} onChange={v => setOp("white_balance", { temp: v })} onCommitStart={snapshotForUndo} />
                  <Slider label="Tinte" value={opOf(recipe, "white_balance").tint} min={-100} max={100} onChange={v => setOp("white_balance", { tint: v })} onCommitStart={snapshotForUndo} />
                </Group>
                <Group title="Geometría">
                  <Slider label="Enderezar (°)" value={recipe.geometry.straighten} min={-45} max={45} step={0.5} def={0}
                    onChange={v => setRecipe(r => { const n = JSON.parse(JSON.stringify(r)) as AnyRecipe; n.geometry.straighten = v; return n; })}
                    onCommitStart={snapshotForUndo} />
                </Group>
              </>
            )}
            {tab === "color" && (
              <>
                <Group title="Color">
                  <Slider label="Vibrance" value={opOf(recipe, "color").vibrance} min={-100} max={100} onChange={v => setOp("color", { vibrance: v })} onCommitStart={snapshotForUndo} />
                  <Slider label="Saturation" value={opOf(recipe, "color").saturation} min={-100} max={100} onChange={v => setOp("color", { saturation: v })} onCommitStart={snapshotForUndo} />
                </Group>
                <Group title="Curvas de tono">
                  <CurveEditor curves={opOf(recipe, "tone_curve") as ToneCurveParams} onCommitStart={snapshotForUndo}
                    onChange={next => setOp("tone_curve", { rgb: next.rgb, r: next.r, g: next.g, b: next.b })} />
                </Group>
                <Group title="HSL por color">
                  {(["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"] as const).map(band => (
                    <div key={band} style={{ borderBottom: "1px dashed rgba(255,255,255,0.05)", paddingBottom: 6, marginBottom: 6 }}>
                      <div style={{ ...muted, marginBottom: 2 }}>{band}</div>
                      <Slider label="hue" value={(opOf(recipe, "hsl") as any)[band].h} min={-30} max={30} onChange={v => setOp("hsl", { [band]: { ...(opOf(recipe, "hsl") as any)[band], h: v } })} onCommitStart={snapshotForUndo} />
                      <Slider label="sat" value={(opOf(recipe, "hsl") as any)[band].s} min={-100} max={100} onChange={v => setOp("hsl", { [band]: { ...(opOf(recipe, "hsl") as any)[band], s: v } })} onCommitStart={snapshotForUndo} />
                      <Slider label="lum" value={(opOf(recipe, "hsl") as any)[band].l} min={-100} max={100} onChange={v => setOp("hsl", { [band]: { ...(opOf(recipe, "hsl") as any)[band], l: v } })} onCommitStart={snapshotForUndo} />
                    </div>
                  ))}
                </Group>
                <Group title="Color grading">
                  {(["shadows", "midtones", "highlights"] as const).map(region => (
                    <div key={region} style={{ marginBottom: 6 }}>
                      <div style={muted}>{region}</div>
                      <Slider label="matiz" value={(opOf(recipe, "color_grading") as any)[region].hue} min={0} max={360} onChange={v => setOp("color_grading", { [region]: { ...(opOf(recipe, "color_grading") as any)[region], hue: v } })} onCommitStart={snapshotForUndo} />
                      <Slider label="fuerza" value={(opOf(recipe, "color_grading") as any)[region].sat} min={0} max={100} onChange={v => setOp("color_grading", { [region]: { ...(opOf(recipe, "color_grading") as any)[region], sat: v } })} onCommitStart={snapshotForUndo} />
                    </div>
                  ))}
                  <Slider label="Balance" value={opOf(recipe, "color_grading").balance} min={-100} max={100} onChange={v => setOp("color_grading", { balance: v })} onCommitStart={snapshotForUndo} />
                </Group>
              </>
            )}
            {tab === "detalle" && (
              <Group title="Detalle">
                <Slider label="Texture" value={opOf(recipe, "detail").texture} min={-100} max={100} onChange={v => setOp("detail", { texture: v })} onCommitStart={snapshotForUndo} />
                <Slider label="Clarity" value={opOf(recipe, "detail").clarity} min={-100} max={100} onChange={v => setOp("detail", { clarity: v })} onCommitStart={snapshotForUndo} />
                <Slider label="Sharpen" value={opOf(recipe, "detail").sharpen} min={0} max={100} onChange={v => setOp("detail", { sharpen: v })} onCommitStart={snapshotForUndo} />
                <Slider label="Reducción de ruido" value={opOf(recipe, "detail").denoise} min={0} max={100} onChange={v => setOp("detail", { denoise: v })} onCommitStart={snapshotForUndo} />
              </Group>
            )}
            {tab === "efectos" && (
              <>
                <Group title="Efectos">
                  <Slider label="Grano" value={opOf(recipe, "effects").grain} min={0} max={100} onChange={v => setOp("effects", { grain: v })} onCommitStart={snapshotForUndo} />
                  <Slider label="Viñeta (cantidad)" value={opOf(recipe, "effects").vignetteAmount} min={-100} max={100} onChange={v => setOp("effects", { vignetteAmount: v })} onCommitStart={snapshotForUndo} />
                  <Slider label="Viñeta (punto medio)" value={opOf(recipe, "effects").vignetteMidpoint} min={0} max={100} onChange={v => setOp("effects", { vignetteMidpoint: v })} onCommitStart={snapshotForUndo} />
                  <Slider label="Viñeta (difuminado)" value={opOf(recipe, "effects").vignetteFeather} min={0} max={100} onChange={v => setOp("effects", { vignetteFeather: v })} onCommitStart={snapshotForUndo} />
                </Group>
                <Group title="Blanco y negro">
                  <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11, color: "#d6d0c0", marginBottom: 8 }}>
                    <input type="checkbox" checked={opOf(recipe, "bw").enabled} onChange={e => { snapshotForUndo(); setOp("bw", { enabled: e.target.checked }); }} />
                    Convertir a B/N con mezcla de canales
                  </label>
                  {opOf(recipe, "bw").enabled && (
                    <>
                      <Slider label="Peso R" value={opOf(recipe, "bw").mix.r} min={0} max={100} def={100} onChange={v => setOp("bw", { mix: { ...opOf(recipe, "bw").mix, r: v } })} onCommitStart={snapshotForUndo} />
                      <Slider label="Peso G" value={opOf(recipe, "bw").mix.g} min={0} max={100} def={100} onChange={v => setOp("bw", { mix: { ...opOf(recipe, "bw").mix, g: v } })} onCommitStart={snapshotForUndo} />
                      <Slider label="Peso B" value={opOf(recipe, "bw").mix.b} min={0} max={100} def={100} onChange={v => setOp("bw", { mix: { ...opOf(recipe, "bw").mix, b: v } })} onCommitStart={snapshotForUndo} />
                    </>
                  )}
                </Group>
              </>
            )}
            {tab === "mascaras" && (
              <>
                <Group title="Máscaras (hasta 6)">
                  <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
                    <button type="button" style={smallBtn} onClick={() => addMask("radial")}>+ Radial</button>
                    <button type="button" style={smallBtn} onClick={() => addMask("linear")}>+ Lineal</button>
                    <button type="button" style={smallBtn} onClick={() => addMask("brush")}>+ Pincel</button>
                  </div>
                  {recipe.masks.length === 0 && <div style={muted}>Sin máscaras. Una máscara ajusta exposición/contraste/saturación/temperatura SOLO en su zona — el resto del revelado sigue igual.</div>}
                  {recipe.masks.map(m => (
                    <div key={m.id} style={{ border: selectedMaskId === m.id ? "1px solid rgba(200,184,152,0.45)" : "1px solid rgba(255,255,255,0.07)", borderRadius: 4, padding: 7, marginBottom: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <input type="checkbox" checked={m.enabled} onChange={e => { snapshotForUndo(); mutateRecipe(r => { const mm = r.masks.find(x => x.id === m.id); if (mm) mm.enabled = e.target.checked; }); }} />
                        <button type="button" style={{ ...smallBtn, flex: 1, textAlign: "left" }} onClick={() => { setSelectedMaskId(m.id); if (m.kind === "brush") setMode("brush"); }}>
                          {m.kind === "radial" ? "◎ Radial" : m.kind === "linear" ? "◐ Lineal" : "🖌 Pincel"} {m.invert ? "(invertida)" : ""}
                        </button>
                        <button type="button" style={smallBtn} title="Eliminar máscara"
                          onClick={() => { snapshotForUndo(); mutateRecipe(r => { r.masks = r.masks.filter(x => x.id !== m.id); }); if (selectedMaskId === m.id) setSelectedMaskId(null); }}>✕</button>
                      </div>
                      {selectedMaskId === m.id && (
                        <div style={{ marginTop: 6 }}>
                          <Slider label="Suavidad" value={m.feather} min={0.02} max={1} step={0.01} def={0.5} onChange={v => mutateRecipeLive(m.id, mm => { mm.feather = v; })} onCommitStart={snapshotForUndo} />
                          <Slider label="Exposición" value={m.adjustments.exposure} min={-100} max={100} onChange={v => mutateRecipeLive(m.id, mm => { mm.adjustments.exposure = v; })} onCommitStart={snapshotForUndo} />
                          <Slider label="Contraste" value={m.adjustments.contrast} min={-100} max={100} onChange={v => mutateRecipeLive(m.id, mm => { mm.adjustments.contrast = v; })} onCommitStart={snapshotForUndo} />
                          <Slider label="Saturación" value={m.adjustments.saturation} min={-100} max={100} onChange={v => mutateRecipeLive(m.id, mm => { mm.adjustments.saturation = v; })} onCommitStart={snapshotForUndo} />
                          <Slider label="Temperatura" value={m.adjustments.temp} min={-100} max={100} onChange={v => mutateRecipeLive(m.id, mm => { mm.adjustments.temp = v; })} onCommitStart={snapshotForUndo} />
                          <Slider label="Tinte" value={m.adjustments.tint} min={-100} max={100} onChange={v => mutateRecipeLive(m.id, mm => { mm.adjustments.tint = v; })} onCommitStart={snapshotForUndo} />
                          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 10.5, color: "#d6d0c0" }}>
                            <input type="checkbox" checked={m.invert} onChange={e => { snapshotForUndo(); mutateRecipe(r => { const mm = r.masks.find(x => x.id === m.id); if (mm) mm.invert = e.target.checked; }); }} />
                            Invertir máscara
                          </label>
                        </div>
                      )}
                    </div>
                  ))}
                </Group>
              </>
            )}
            {tab === "recetas" && (
              <>
                <Group title="Presets">
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {PHOTO_PRESETS.map(p => (
                      <button key={p.id} type="button" style={smallBtn} disabled={!imgDims}
                        onClick={() => { snapshotForUndo(); setRecipe(r => applyPreset(r, p)); }}>
                        {p.name}
                      </button>
                    ))}
                  </div>
                </Group>
                <Group title="Historial de versiones">
                  {versions.length === 0 && <div style={muted}>Sin versiones guardadas para esta foto todavía.</div>}
                  {versions.map(v => (
                    <div key={v.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <span style={{ ...muted, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={v.label}>{v.label || "Versión"}</span>
                      <button type="button" style={smallBtn} onClick={() => { snapshotForUndo(); setRecipe(normalizeRecipe(v.recipe_json)); addToast("Versión cargada en el visor — pulsa Aplicar para usarla.", "info"); }}>Cargar</button>
                    </div>
                  ))}
                </Group>
                <Group title="Catálogo (Library)">
                  <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 6 }}>
                    {[0, 1, 2, 3, 4, 5].map(n => (
                      <button key={n} type="button" style={rating >= n && n > 0 ? smallBtnActive : smallBtn}
                        onClick={() => { setRating(n); void apiFetch("/api/photos/catalog", { method: "PUT", body: JSON.stringify({ workspaceId, assetId: assetIdFromUrl(effectiveSrc), sourceUrl: effectiveSrc, rating: n }) }); }}>
                        {n === 0 ? "—" : "★"}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    {(["pick", "unflagged", "reject"] as const).map(f => (
                      <button key={f} type="button" style={flag === f ? smallBtnActive : smallBtn}
                        onClick={() => { setFlag(f); void apiFetch("/api/photos/catalog", { method: "PUT", body: JSON.stringify({ workspaceId, assetId: assetIdFromUrl(effectiveSrc), sourceUrl: effectiveSrc, flag: f }) }); }}>
                        {f === "pick" ? "✓ Pick" : f === "reject" ? "✕ Reject" : "○"}
                      </button>
                    ))}
                  </div>
                </Group>
              </>
            )}
          </div>
          )}
        </div>
      </div>
    </div>
  );

  // ── helpers que usan closure del render (máscara viva sin push de historial) ──
  function mutateRecipeLive(maskId: string, fn: (m: PhotoMask) => void) {
    setRecipe(r => {
      const next = JSON.parse(JSON.stringify(r)) as AnyRecipe;
      const mm = next.masks.find(x => x.id === maskId);
      if (mm) fn(mm);
      return normalizeRecipe(next);
    });
  }
}

// ── helpers de módulo ──

function opOf<T = Record<string, any>>(recipe: AnyRecipe, type: string): T {
  return (recipe.ops.find(o => o.type === type)?.params ?? {}) as T;
}

function Group(props: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, color: "#c8b898", marginBottom: 7, textTransform: "uppercase" }}>{props.title}</div>
      {props.children}
    </div>
  );
}

function hitCropHandle(p: { x: number; y: number }, d: NormRect, tol: number): string | null {
  const corners: Array<[string, number, number]> = [
    ["nw", d.x, d.y], ["ne", d.x + d.w, d.y], ["sw", d.x, d.y + d.h], ["se", d.x + d.w, d.y + d.h],
  ];
  for (const [name, cx, cy] of corners) {
    if (Math.abs(p.x - cx) < tol && Math.abs(p.y - cy) < tol) return name;
  }
  return null;
}

function resizeCrop(base: NormRect, corner: string, dx: number, dy: number, aspect: number | null): NormRect {
  let { x, y, w, h } = base;
  if (corner.includes("w")) { x = clamp(x + dx, 0, x + w - 0.05); w = base.w + (base.x - x); }
  else { w = clamp(w + dx, 0.05, 1 - x); }
  if (corner.includes("n")) { y = clamp(y + dy, 0, y + h - 0.05); h = base.h + (base.y - y); }
  else { h = clamp(h + dy, 0.05, 1 - y); }
  if (aspect != null) {
    // mantiene el ratio relativo al aspect del lienzo de salida
    h = clamp(w / aspect, 0.05, 1 - y);
  }
  return { x, y, w, h };
}
