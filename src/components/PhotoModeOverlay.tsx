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
import { PhotoLibraryPanel } from "./PhotoLibraryPanel";

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
  const [mode, setMode] = useState<"edit" | "crop" | "brush">("edit");
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
  const drag = useRef<{ kind: "pan" | "split" | "crop-move" | "crop-resize" | "paint"; startX: number; startY: number; base: any; corner?: string } | null>(null);

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
    drag.current = { kind: "pan", startX: e.clientX, startY: e.clientY, base: { ...view } };
  };

  const stagePointerMove = (e: React.PointerEvent) => {
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
    }
  };

  const stagePointerUp = () => {
    const d = drag.current;
    drag.current = null;
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
    const blob = await renderer.renderToBlob("image/jpeg", 0.92, maxSide);
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
      const blob = await renderer.renderToBlob("image/png");
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
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((mod && e.key.toLowerCase() === "y") || (mod && e.shiftKey && e.key.toLowerCase() === "z")) { e.preventDefault(); redo(); }
      else if (e.key === "Escape") { if (mode !== "edit") setMode("edit"); else if (split != null) setSplit(null); else onClose(); }
      else if (e.key === "0") setView({ zoom: 1, panX: 0, panY: 0 });
      else if (e.key === "c") enterCropMode();
      else if (e.key === "b" && activeMask) setMode(m => (m === "brush" ? "edit" : "brush"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undo, redo, mode, split, activeMask]);

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
            onWheel={e => { e.preventDefault(); setView(v => ({ ...v, zoom: clamp(v.zoom * Math.exp(-e.deltaY * 0.0012), 0.2, 12) })); }}
            style={{ flex: 1, position: "relative", overflow: "hidden", background: "#131313", cursor: mode === "brush" ? "crosshair" : mode === "crop" ? "default" : "grab", touchAction: "none" }}
          >
            <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
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
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3, padding: "7px 8px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            {(["luz", "color", "detalle", "efectos", "mascaras", "recetas"] as PhotoTab[]).map(t => (
              <button key={t} type="button" style={tab === t ? smallBtnActive : smallBtn} onClick={() => setTab(t)}>
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
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
