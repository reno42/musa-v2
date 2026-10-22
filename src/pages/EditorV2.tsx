import React, { useState, useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { rasterizeFrame, canvasToBlob, inlineFrameImages, mapBodySelectors, type InlineImageOptions } from "../lib/frameCapture";
import { resolveAccountName } from "../lib/accountName";
import { thumbnailScale } from "../lib/autoSnapshot";
import { isPreviewSnoozeDays, PREVIEW_SNOOZE_DAYS, shouldShowPreviewReminder, type PreviewSnoozeDays } from "../../shared/previewReminder.ts";
import { downloadBlob } from "../lib/download";
import { CodePanel } from "../components/CodePanel";
import { GoogleFontPicker } from "../components/GoogleFontPicker";
import { ensureCustomFontImport, injectCustomFontIntoFrames, loadCustomFontInDocument, type CustomFont } from "../lib/customFonts";
import { FileInfoPanel } from "../components/FileInfoPanel";
import { StyleLibraryPanel } from "../components/StyleLibraryPanel";
import { DesignSystemPanel } from "../components/DesignSystemPanel";
import { FloatingToolbar } from "../components/FloatingToolbar";
import { ExportPanel, type ExportFormat } from "../components/ExportPanel";
import { TopbarMenu, TopbarMenuItem } from "../components/TopbarMenu";
import { OnboardingTour } from "../components/OnboardingTour";
import { PrintExportDialog } from "../components/PrintExportDialog";
import { DesignPresentation } from "../components/DesignPresentation";
import {
  PRINT_PROFILES, PRINT_ENGINE_BASE, computePrintGeometry, buildPrintPdf,
  printFilename, printBackground, type PrintOptions,
} from "../lib/printExport";
import { clampToCmykGamut, mapCssColors } from "../lib/cmykGamut";
import type { PrintProgressInfo, SeparationsResult } from "../lib/printProtocol";
import { loadPrintManifest, ensurePrintEngine, convertPdfToCmyk, renderSoftProof, renderSeparations } from "../lib/cmykEngine";
import { DesignImportModal } from "../components/DesignImportModal";
import { ImportRouterModal, type ImportRoute, detectRoute as detectImportRoute } from "../components/ImportRouterModal";
import type { ImportResult } from "../lib/designImport";
import { InfiniteHtmlCanvas, type HtmlToolName, type WandClickPoint, type CanvasCommentPin } from "../components/InfiniteHtmlCanvas";
import { CanvasContextMenu } from "../components/CanvasContextMenu";
import type { Guide, ColumnConfig } from "../components/CanvasGuides";
import type { FrameData, HtmlCanvasObject, LayerSelectionRequest, LayerVisualGeometry, SelectedElementInfo, ShapeOptions } from "../components/DesignFrame";
import { frameBoundsRegistry, frameMarqueeRegistry } from "../components/DesignFrame";
import { NumericTransformDialog, type NumericTransformValues } from "../components/NumericTransformDialog";
import { toHexColor } from "../lib/colorUtils";
import { SOCIAL_FORMATS, CUSTOM_FORMAT_ID, clampFrameDimension } from "../lib/socialFormats";
import { HtmlContextualPanel, ScrubbyInput } from "../components/HtmlContextualPanel";
import { AnimationPanel } from "../components/AnimationPanel";
import { VideoModeOverlay } from "../components/VideoModeOverlay";
import { PhotoModeOverlay } from "../components/PhotoModeOverlay";
import { PhotoFramePickerModal } from "../components/PhotoFramePickerModal";
import { frameRasterLayerId, frameSourceHash, parseFrameImages, type PhotoTarget } from "../../shared/photoTargets";
import { emptyVideoTimelineDoc, normalizeVideoTimelineDoc, resolveProject, type VideoTimelineDoc } from "../lib/videoTimelineDoc";
import { VideoDocStore, type VideoDocApplyMeta } from "../lib/videoDocStore";
import { placeTake, type ReelTakeLayout } from "../lib/reelLayout";
import type { AnimationSchema } from "../../shared/animationSchema.ts";
import { exportFrameVideo } from "../lib/videoExport";
import { HtmlLayersPanel } from "../components/HtmlLayersPanel";
import { BatchAMator } from "../components/BatchAMator";
import { SvgImportDialog, type RasterImageImport } from "../components/SvgImportDialog";
import { InsertToolbar } from "../components/InsertToolbar";
import { PasteHtmlModal, type PasteResult } from "../components/PasteHtmlModal";
import { parseHtmlDocument } from "../lib/htmlParser";
import { IconPicker, type IconPayload, type IllustrationPayload, type PhotoPayload } from "../components/IconPicker";
import { VersionHistoryPanel } from "../components/VersionHistoryPanel";
// Musa Hands (REQ Gesture Mode): on-device hand tracking wired to the SAME
// channels as the human: the ChatFAB viewport event, animationPlayback and
// the DocumentStore. No new editor handlers are invented.
import { GestureHUD } from "../components/GestureHUD";
import { GestureManager, type GestureEditorActions } from "../lib/gesture/bridge";
import { dispatchEditorViewport } from "../lib/editorViewport";
import { getFramePlayback, playFrame, stopFrame, seekFrame } from "../lib/animationPlayback";
// Air-cursor route: the pointing finger is the mouse — gesturePointer turns
// cursor intents into real mouse events so every tool works hands-first.
import { GestureCursor } from "../components/GestureCursor";
import { gestureCursorMove, gestureCursorDown, gestureCursorUp } from "../lib/gesture/gesturePointer";

import { useDockablePanel } from "../hooks/useDockablePanel";
import { getTemplate, saveLocal } from "../lib/templateApi";
import { apiFetch } from "../lib/supabase";
import { getApiHeaders } from "../lib/apiKey";
import { mcpCall } from "../lib/mcpClient";
import { AI_PROVIDERS, getProvider } from "../lib/aiProviders";
import { fetchKeyStatuses, saveProviderKey, deleteProviderKey, type KeyStatusMap } from "../lib/userKeys";
import { fetchUserPrefs, saveUserPrefs } from "../lib/userPrefs";
import { streamVectorize, type QuiverEvent } from "../lib/quiverStream";
// REQ-043 Fase 1 — buscatrazos local: EL MISMO motor puro que el tool MCP
// trace_image (cero drift), corriendo en un worker del navegador.
import { traceRaster } from "../lib/traceClient";
import { defaultTraceParams } from "../lib/trace/params";
import { tracePresetByName } from "../lib/trace/presets";
import { traceResultPathsMarkup } from "../lib/trace/index";
import { subscribeTemplate, broadcastChange, subscribePresence } from "../lib/supabaseRealtime";
import {
  appendCssOverride,
  cloneLayerCss,
  cloneLayerTreeCss,
  filterCssDeclarations,
  extractLayerTreeCss,
  getCssPropertyValue,
  getExactRuleDeclarations,
  getLayerIdsWithDeclaration,
  mergeCssRules,
  parseCssDeclarations,
  removeLayerCss,
  removeLayersCss,
  removeCssOverride,
  removeTransformFunction,
  setTransformFunction,
  updateCssProperty,
} from "../lib/cssMutations";
import { pathfinder, ringsBounds, ringsToPathD, sampleShapeRing, type PathfinderOp } from "../lib/pathBoolean";
import { addAnchorPoints, averagePath, joinPaths, removeRedundantPoints, removeStrayAnchors, reversePath, simplifyPath, smoothPath } from "../lib/pathOps/edit";
import { offsetPathD, outlineStrokeD, type StrokeOpts } from "../lib/pathOps/offset";
import { makeCompoundD, releaseCompoundD } from "../lib/pathOps/compound";
import { blendD } from "../lib/pathOps/blend";
import {
  applyDistortion,
  type ApplyDistortOptions,
  type DistortEffect,
} from "../lib/pathOps/distort";
import { resetLayerPaintHtml, swapLayerPaintHtml, writeLayerFillHtml } from "../lib/layerPaint";
import {
  applyLayerSvgFill,
  changeLayerTag,
  createLayerId,
  dedupeLayerIds,
  deleteLayerFromHtml,
  duplicateLayerInHtml,
  ensureLayerIds,
  extractLayerFromHtml,
  getLayerAttribute,
  groupLayersInHtml,
  insertLayerIntoHtml,
  moveLayerToStackEdge,
  nestedGroupIds,
  pasteLayerFromHtml,
  remapLayerTreeForTarget,
  removeLayerAttribute,
  reorderLayerInStack,
  reparentLayerInHtml,
  replaceLayerPathData,
  replaceLayerText,
  setLayerAttributes,
  ungroupLayerInHtml,
  wrapLayersInFrame,
  type LayerDropPlacement,
  type LayerStackChange,
  type LayerStackDirection,
  type LayerStackEdge,
  type LayerStackPlacement,
  type SvgFillMedia,
} from "../lib/htmlMutations";
import {
  extractLayerCssBlocks,
  layerIsSeparable,
  measureLetterBoxes,
  restoreSeparatedText,
  separateTextLayer,
} from "../lib/textSeparation";
import { ensureGoogleFontImport, injectGoogleFontIntoFrames, sanitizeGoogleFontUrl } from "../lib/googleFonts";
import { cssFontFamily, needsWebfont, primaryFamily } from "../lib/fontFamily";
import {
  persistDesignClipboard,
  readDesignClipboard,
  type DesignClipboard,
} from "../lib/designClipboard";
import { analyzePathData, parsePathData, serializePathData } from "../lib/pathData";
import { applyBrushStroke, applyPathMask, applySegmentMaskPath, applySelectionFill, reBakePathMask, removeImageMask } from "../lib/maskApply";
import type { BrushStroke, MaskMode } from "../../shared/maskBake.ts";
import { styleTargets, updateSelection } from "../lib/selectionModel";
import { cornersFromShapePath, generatePolygonPath, generateStarPath, clampShapeCount, parseVertexRadiiAttr, serializeVertexRadiiAttr, verticesToPath } from "../lib/shapePaths";
import { installAgentBridge } from "../lib/agentBridge";
import { findCanvasObjectPosition, findFrameContainingCanvasRect, inferCanvasObjectKind, normalizeCanvasObject } from "../lib/canvasObjects";
import { resizeFrameBodyCss } from "../lib/resizeFrameBodyCss";
import { measureContainerForBake, convertContainerToGroup, convertGroupToContainer, ungroupPreservingLayout } from "../lib/groupSemantics";
import { DocumentStore, createDocumentStore } from "../lib/documentStore";
import { useAuth } from "../lib/auth";
import { useToast } from "../components/Toast";
import {
  IconArrowLeft, IconSliders, IconPalette,
  IconBot, IconType, IconCopy, IconTrash,
  IconDownload, IconTag,
  IconPointer, IconHand, IconZoomIn, IconZoomOut, IconMaximize,
  IconRectangle, IconCircleOutline, IconPen, IconChevronDown,
  IconAlignLeft, IconAlignCenter, IconAlignRight,
  IconHistory, IconWand, IconGrid, IconColumns, IconRuler, IconShapes, IconEraser, IconX, IconInfo,
  IconSearch, IconLayers,
  IconUpload, IconCode, IconShare, IconPlay, IconCamera, IconMonitor,
} from "../shared/icons";
import type { RealtimeChannel } from "@supabase/supabase-js";

// Deterministic hash for content change tracking (client-side, no crypto dependency)
function pxValue(value: string): number | null {
  const match = value.match(/^(-?\d+(?:\.\d+)?)px/);
  return match ? parseFloat(match[1]) : null;
}

function inlineStyleValue(el: Element, prop: string): string {
  const style = (el as HTMLElement).style;
  return style ? style.getPropertyValue(prop) : "";
}

function layerBoxValue(el: Element, css: string, layerId: string, prop: string): number | null {
  return pxValue(inlineStyleValue(el, prop))
    ?? pxValue(getCssPropertyValue(css, `[data-layer-id="${layerId}"]`, prop));
}

function roundedRectPath(w: number, h: number, radius: string): string {
  let rx = 0, ry = 0;
  const br = radius.trim();
  if (br.endsWith("%")) {
    const pct = Math.min(50, parseFloat(br) || 0) / 100;
    rx = w * pct; ry = h * pct;
  } else if (br) {
    const pxr = parseFloat(br) || 0;
    rx = Math.min(pxr, w / 2); ry = Math.min(pxr, h / 2);
  }
  return (rx > 0 || ry > 0)
    ? `M${rx},0 H${w - rx} A${rx},${ry} 0 0 1 ${w},${ry} V${h - ry} A${rx},${ry} 0 0 1 ${w - rx},${h} H${rx} A${rx},${ry} 0 0 1 0,${h - ry} V${ry} A${rx},${ry} 0 0 1 ${rx},0 Z`
    : `M0,0 H${w} V${h} H0 Z`;
}

/** Flatten a shape layer to one polygon ring in FRAME coordinates, plus its
 * fill. SVG shapes carry `d` in viewBox-local space — position/scale come
 * from inline style first, then the layer's CSS rule (the server tool used
 * the viewBox origin as position, teleporting every SVG shape to 0,0).
 * Div shapes (rect/circle tools) are synthesized from their resolved box,
 * same formula as the server's geometryFromDiv. Null for text/group/image
 * layers. */
function extractShapeRing(el: Element, css: string): { ring: [number, number][]; fill: string } | null {
  const layerId = el.getAttribute("data-layer-id") || "";
  const kind = el.getAttribute("data-layer-kind");
  if (!layerId || kind === "text" || kind === "group" || kind === "image" || el.tagName.toLowerCase() === "img") return null;
  const tag = el.tagName.toLowerCase();
  let local: [number, number][] | null = null;
  let fill = "#8B5CF6";
  const left = layerBoxValue(el, css, layerId, "left") ?? 0;
  const top = layerBoxValue(el, css, layerId, "top") ?? 0;
  let scaleX = 1, scaleY = 1, originX = 0, originY = 0;

  if (tag === "svg" || tag === "path") {
    const pathEl = tag === "path" ? el : el.querySelector("path");
    const polygonEl = pathEl ? null : el.querySelector("polygon");
    const polygonD = polygonEl
      ? (() => { const pts = (polygonEl.getAttribute("points") || "").trim(); return pts ? `M${pts} Z` : ""; })()
      : "";
    const d = pathEl?.getAttribute("d") || polygonD;
    if (!d) return null;
    local = sampleShapeRing(d);
    fill = pathEl?.getAttribute("fill") || polygonEl?.getAttribute("fill") || fill;
    const vb = (el.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number);
    if (vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) {
      originX = vb[0]; originY = vb[1];
      const w = layerBoxValue(el, css, layerId, "width");
      const h = layerBoxValue(el, css, layerId, "height");
      scaleX = w && w > 0 ? w / vb[2] : 1;
      scaleY = h && h > 0 ? h / vb[3] : 1;
    }
  } else {
    const w = layerBoxValue(el, css, layerId, "width");
    const h = layerBoxValue(el, css, layerId, "height");
    if (!w || !h) return null;
    const br = inlineStyleValue(el, "border-radius")
      || getCssPropertyValue(css, `[data-layer-id="${layerId}"]`, "border-radius");
    local = sampleShapeRing(roundedRectPath(w, h, br));
    fill = inlineStyleValue(el, "background-color")
      || getCssPropertyValue(css, `[data-layer-id="${layerId}"]`, "background-color")
      || getCssPropertyValue(css, `[data-layer-id="${layerId}"]`, "background")
      || fill;
  }
  if (!local || local.length < 3) return null;
  return {
    ring: local.map(([x, y]) => [left + (x - originX) * scaleX, top + (y - originY) * scaleY] as [number, number]),
    fill,
  };
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

// ── REQ-026 BUG-004: telemetría del botón Back ─────────────────────
// El reporte "Back to Dashboard requiere doble click con paneles
// abiertos" NO es reproducible en código: la auditoría CSS no encontró
// overlay que robe el click (topbar z-30 @ 0-40px; right-panel z-20 @
// top:56px desktop y z-50 @ top:48px tablet — sin solape; el único
// overlay por encima del topbar es el backdrop del menú móvil, cuyo
// primer click legítimamente cierra el modal). Se instrumenta el botón
// para diagnosticar en vivo: contador sync en localStorage (sobrevive a
// la navegación) + breadcrumb de consola. Nunca bloquea la navegación.
function telemetryBackClick(source: "topbar" | "error-view") {
  try {
    const raw = localStorage.getItem("futuraria-editor-back-clicks");
    const log = raw
      ? (JSON.parse(raw) as { total: number; sources: Record<string, number> })
      : { total: 0, sources: {} as Record<string, number> };
    log.total += 1;
    log.sources[source] = (log.sources[source] || 0) + 1;
    localStorage.setItem("futuraria-editor-back-clicks", JSON.stringify(log));
    console.info(`[editor-back] click #${log.total} (${source}) — REQ-026 BUG-004`);
  } catch {
    /* localStorage lleno/bloqueado: la telemetría no puede impedir navegar */
  }
}

interface EditorV2Props {
  templateId: string;
  onBack: () => void;
  onOpenTemplate?: (id: string) => void;
}

const FRAME_GAP = 100;
const BUILD_VERSION = "persist-fix-v4-2026-06-30";
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 5;

let generatedFrameSequence = 0;
function createFrameId(): string {
  generatedFrameSequence++;
  return `frame_${Date.now().toString(36)}_${generatedFrameSequence.toString(36)}`;
}

function nextFrameNumber(frames: FrameData[]): number {
  return frames.reduce((highest, frame) => {
    const match = /^Frame\s+(\d+)$/i.exec(frame.name.trim());
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0) + 1;
}

let generatedOrphanSeq = 0;
function createOrphanId(): string {
  generatedOrphanSeq++;
  return `orphan_${Date.now().toString(36)}_${generatedOrphanSeq.toString(36)}`;
}

function cloneFrame(source: FrameData, x: number, y: number, name: string): FrameData {
  return {
    ...source,
    id: createFrameId(),
    name,
    x: Math.round(x),
    y: Math.round(y),
  };
}

function applyLayerStack(css: string, siblingLayerIds: string[]): string {
  return siblingLayerIds.reduce((updated, layerId, index) => updateCssProperty(
    updated,
    `[data-layer-id="${layerId}"]`,
    "z-index",
    `${index + 1} !important`,
  ), css);
}

function parseTranslate(value: string): { x: number; y: number } {
  if (!value || value === "none") return { x: 0, y: 0 };
  const parts = value.split(/\s+/).map(part => parseFloat(part) || 0);
  return { x: parts[0] || 0, y: parts[1] || 0 };
}

interface PenStyle {
  fill: string;
  stroke: string;
  strokeWidth: string;
  strokeLinecap: string;
  strokeLinejoin: string;
  strokeDasharray: string;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.matches("input, textarea, select, [contenteditable='true']") || target.isContentEditable;
}

/** REQ-045: duplica los bloques CSS `[data-layer-id="X"] …` de una capa para
 * un clon (release de compound y blend heredan la pintura de la pluma, que
 * vive en CSS, no en atributos del path). */
function cloneLayerCssBlocks(css: string, sourceId: string, newId: string): string {
  if (!css) return "";
  const re = new RegExp(`\\[data-layer-id="${sourceId}"\\][^{}]*\\{[^}]*\\}`, "g");
  const blocks = css.match(re);
  if (!blocks || blocks.length === 0) return "";
  return "\n" + blocks.map(b => b.split(`data-layer-id="${sourceId}"`).join(`data-layer-id="${newId}"`)).join("\n") + "\n";
}

/**
 * Robust Shadow DOM contenteditable detection using composedPath().
 * In Shadow DOM, `e.target` is retargeted to the shadow host during capture phase,
 * and `document.activeElement` may be null or the shadow host between keystrokes.
 * `composedPath()` preserves the full event path including elements inside the shadow tree.
 */
function isEditingInShadowDOM(e: KeyboardEvent): boolean {
  const path = e.composedPath();
  for (let i = 0; i < path.length; i++) {
    const el = path[i];
    if (el instanceof HTMLElement) {
      if (el.isContentEditable || el.matches("input, textarea, select, [contenteditable='true']")) {
        return true;
      }
    }
  }
  return false;
}

const GEOMETRY_PROPERTIES = new Set([
  "position", "top", "right", "bottom", "left", "z-index",
  "width", "height", "min-width", "min-height", "max-width", "max-height",
  "display", "transform", "transform-origin", "translate", "scale",
]);

const COPY_STYLE_PROPERTIES = new Set([
  "font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing",
  "text-align", "text-decoration", "text-transform", "color", "opacity",
  "background", "background-color", "background-image", "background-size", "background-position", "background-repeat",
  "border", "border-width", "border-style", "border-color", "border-radius",
  "box-shadow", "text-shadow", "filter", "backdrop-filter", "mix-blend-mode",
]);

const elemBtnStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)", color: "#ccc",
  border: "1px solid rgba(255,255,255,0.08)", borderRadius: 4,
  padding: "3px 8px", fontSize: 11, cursor: "pointer",
  fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center",
  minWidth: 28, minHeight: 24,
};
const sepStyle: React.CSSProperties = {
  width: 1, height: 20, background: "rgba(255,255,255,0.08)", margin: "0 4px",
};
const DEFAULT_HTML = `<div class="card">
  <h1 data-layer-id="heading">Hello World</h1>
  <p data-layer-id="paragraph">Edit this HTML + CSS in the panel on the left.</p>
</div>`;

const DEFAULT_CSS = `body {
  font-family: 'Inter', system-ui, sans-serif;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  margin: 0;
}

.card {
  background: rgba(255,255,255,0.95);
  border-radius: 16px;
  padding: 40px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
  max-width: 480px;
  text-align: center;
}

h1 {
  font-size: 32px;
  font-weight: 700;
  color: #1a1a2e;
  margin: 0 0 16px;
}

p {
  font-size: 16px;
  color: #666;
  line-height: 1.6;
  margin: 0;
}`;

/**
 * Nano Banana (Gemini image generation) models offered in the generate-image
 * panel. All consume the SAME Google API key as image_to_design — the model
 * preference is stored separately (localStorage) so it never fights with the
 * vision model used by Image to Design.
 */
const NANO_BANANA_MODELS = [
  { id: "gemini-3.1-flash-image", label: "Nano Banana 2 — rápido y equilibrado" },
  { id: "gemini-3.1-flash-lite-image", label: "Nano Banana 2 Lite — ultra rápido" },
  { id: "gemini-3-pro-image", label: "Nano Banana Pro — máxima calidad" },
  { id: "gemini-2.5-flash-image", label: "Nano Banana (2.5) — generación previa" },
];
const NANO_BANANA_MODEL_SLOT = "futuraria-nanobanana-model";

/**
 * Output formats for the 🍌 panel. Gemini native image generation only
 * accepts these 10 aspect ratios — an arbitrary size (1350×1080, A4…)
 * snaps to the nearest one at request time.
 */
const NANO_BANANA_ASPECTS = [
  { id: "1:1", label: "1:1 — Cuadrado (1080×1080)" },
  { id: "16:9", label: "16:9 — Horizontal (1920×1080)" },
  { id: "9:16", label: "9:16 — Vertical (1080×1920)" },
  { id: "4:3", label: "4:3 — Horizontal clásico" },
  { id: "3:4", label: "3:4 — Vertical clásico" },
  { id: "3:2", label: "3:2 — Foto horizontal" },
  { id: "2:3", label: "2:3 — Foto vertical" },
  { id: "5:4", label: "5:4" },
  { id: "4:5", label: "4:5 — Retrato IG" },
  { id: "21:9", label: "21:9 — Ultrawide" },
];
const NANO_BANANA_ASPECT_SLOT = "futuraria-nanobanana-aspect";
const NANO_BANANA_STRICT_SLOT = "futuraria-nanobanana-strict";
const NANO_BANANA_TEMP_SLOT = "futuraria-nanobanana-temp";

/** Nearest Gemini-supported ratio for an arbitrary pixel size (e.g. A4 → 2:3). */
function nearestNanoBananaAspect(w: number, h: number): string {
  const target = w / h;
  let best = NANO_BANANA_ASPECTS[0].id;
  let bestDiff = Infinity;
  for (const a of NANO_BANANA_ASPECTS) {
    const [aw, ah] = a.id.split(":").map(Number);
    const diff = Math.abs(aw / ah - target);
    if (diff < bestDiff) { bestDiff = diff; best = a.id; }
  }
  return best;
}

/**
 * Layer separation (Seedream 5.0 Pro via WaveSpeedAI). The async job runs on
 * WaveSpeed's GPUs (median ~77s), so the flow is submit + browser-side
 * polling: each status check is a sub-second server call and the ETA below
 * is a median-based estimate shown as a countdown.
 */
const LAYER_SPLIT_MODELS = [
  { id: "seedream-v5.0-pro/layer-decomposition", label: "Seedream 5.0 Pro — separación en capas" },
];
const LAYER_SPLIT_RESOLUTIONS = [
  { id: "1k", label: "1k — estándar (~$0.77)" },
  { id: "1.5k", label: "1.5k — estándar (~$0.77)" },
  { id: "2k", label: "2k — alta resolución (~$1.53)" },
];
const LAYER_SPLIT_MODEL_SLOT = "futuraria-layersplit-model";
const LAYER_SPLIT_RES_SLOT = "futuraria-layersplit-resolution";
const LAYER_SPLIT_SPEED_SLOT = "futuraria-layersplit-speed";
const LAYER_SPLIT_ETA_MS = 80_000;        // median-based ETA for the countdown
const LAYER_SPLIT_FIRST_CHECK_MS = 30_000; // first status check
const LAYER_SPLIT_CHECK_EVERY_MS = 12_000; // then every ~12s (free checks)
const LAYER_SPLIT_MAX_MS = 8 * 60_000;     // hard stop for the wait loop

/**
 * Image → video (RunwayML Gen-4, topbar 🎬). Same async pattern as layer
 * separation: submit + browser-side polling with free status checks. The
 * generated mp4 is re-uploaded to our bucket (Runway output URLs are
 * temporary) and placed in a frame NEXT TO the source image.
 */
const VIDEO_GEN_MODELS = [
  { id: "gen4_turbo", label: "Gen-4 Turbo — rápido (~$0.25 los 5s)" },
  { id: "gen4.5", label: "Gen-4.5 — máxima calidad (~$0.50 los 5s)" },
];
const VIDEO_GEN_RATIOS = [
  { id: "1280:720", label: "1280:720 — horizontal" },
  { id: "720:1280", label: "720:1280 — vertical" },
  { id: "960:960", label: "960:960 — cuadrado" },
  { id: "1104:832", label: "1104:832 — 4:3" },
  { id: "832:1104", label: "832:1104 — 3:4" },
  { id: "1584:672", label: "1584:672 — 21:9 cine" },
  { id: "672:1584", label: "672:1584 — 9:21" },
];
const VIDEO_GEN_MODEL_SLOT = "futuraria-videogen-model";
const VIDEO_GEN_RATIO_SLOT = "futuraria-videogen-ratio";
const VIDEO_GEN_ETA_MS = 90_000;         // median-based ETA for the countdown
const VIDEO_GEN_FIRST_CHECK_MS = 20_000; // first status check
const VIDEO_GEN_CHECK_EVERY_MS = 10_000; // then every ~10s (free checks)
const VIDEO_GEN_MAX_MS = 10 * 60_000;    // hard stop for the wait loop

/** Aspect ratio (w/h) of an image blob — used to size loose-asset frames. */
async function blobAspect(blob: Blob): Promise<number> {
  const bmp = await createImageBitmap(blob);
  const ratio = bmp.width / Math.max(1, bmp.height);
  bmp.close();
  return ratio;
}

/**
 * Fallback placement when Seedream returns layers WITHOUT bounding boxes:
 * masked template matching against the source image. Element layers are
 * tight crops of the original (upscaled), so a coarse-to-fine search over a
 * scale ladder with an alpha-masked mean-absolute-difference score (solid
 * interior pixels only) recovers each crop's original rect. Returns the
 * match as fractions of the source image (0-1), or null when nothing
 * matches confidently — the caller then parks that layer as a loose asset.
 */
type LayerHit = { left: number; top: number; width: number; height: number };
async function locateLayerInImage(origUrl: string, layerBlob: Blob): Promise<LayerHit | null> {
  const toBitmap = async (src: string | Blob) => {
    const blob = typeof src === "string" ? await (await fetch(src)).blob() : src;
    return createImageBitmap(blob);
  };
  const toData = (bmp: ImageBitmap, w: number, h: number) => {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("canvas 2d no disponible");
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    return ctx.getImageData(0, 0, c.width, c.height);
  };
  // Masked MAD of tpl over orig at (px, py), sampling only the solid-alpha
  // interior. Early-bails on offsets that are already hopeless.
  const mad = (orig: ImageData, tpl: ImageData, solid: Int32Array, px: number, py: number, bail: number) => {
    let sum = 0, n = 0;
    const oW = orig.width, tW = tpl.width;
    for (let s = 0; s < solid.length; s += 2) {
      const x = solid[s], y = solid[s + 1];
      const ti = (y * tW + x) << 2;
      const oi = ((py + y) * oW + (px + x)) << 2;
      sum += Math.abs(tpl.data[ti] - orig.data[oi])
        + Math.abs(tpl.data[ti + 1] - orig.data[oi + 1])
        + Math.abs(tpl.data[ti + 2] - orig.data[oi + 2]);
      n += 3;
      if (n > 288 && sum / n > bail) return Infinity;
    }
    return sum / Math.max(1, n);
  };

  const origBmp = await toBitmap(origUrl);
  const layerBmp = await toBitmap(layerBlob);
  const aspect = layerBmp.width / Math.max(1, layerBmp.height);
  const fit = (max: number) => aspect >= 1
    ? { w: max, h: Math.max(1, Math.round(max / aspect)) }
    : { w: Math.max(1, Math.round(max * aspect)), h: max };

  // Coarse pass: candidate on-canvas widths as a fraction of the original,
  // stepped ~1.3x apart, on a 256px working copy.
  const o = fit(256);
  const orig = toData(origBmp, o.w, o.h);
  let best = { score: Infinity, fw: 0, fh: 0, fx: 0, fy: 0 };
  for (const frac of [0.06, 0.09, 0.12, 0.16, 0.21, 0.27, 0.35, 0.45, 0.58, 0.74, 0.92, 1]) {
    const tW = Math.round(o.w * frac);
    const tH = Math.max(4, Math.round(tW / aspect));
    if (tW < 4 || tW > o.w || tH > o.h) continue;
    const tpl = toData(layerBmp, tW, tH);
    const solidArr: number[] = [];
    for (let y = 0; y < tH; y++) for (let x = 0; x < tW; x++) {
      if (tpl.data[((y * tW + x) << 2) + 3] > 200) solidArr.push(x, y);
    }
    if (solidArr.length < 320) continue; // mostly transparent — nothing to anchor on
    const solid = Int32Array.from(solidArr);
    const step = Math.max(2, Math.round(Math.min(tW, tH) / 10));
    for (let py = 0; py + tH <= o.h; py += step) {
      for (let px = 0; px + tW <= o.w; px += step) {
        const score = mad(orig, tpl, solid, px, py, 60);
        if (score < best.score) best = { score, fw: tW / o.w, fh: tH / o.h, fx: px / o.w, fy: py / o.h };
      }
    }
  }
  if (best.score > 45) return null; // not even a coarse candidate

  // Refine pass at 2x resolution around the coarse hit: the true size
  // usually sits between ladder steps, so probe a small size/position
  // neighborhood (samples capped to keep this fast).
  const r = fit(512);
  const orig2 = toData(origBmp, r.w, r.h);
  for (const fmul of [0.84, 0.92, 1, 1.09, 1.18]) {
    const tW = Math.max(4, Math.round(r.w * best.fw * fmul));
    const tH = Math.max(4, Math.round(tW / aspect));
    if (tW > r.w || tH > r.h) continue;
    const tpl = toData(layerBmp, tW, tH);
    const solidArr: number[] = [];
    for (let y = 0; y < tH; y++) for (let x = 0; x < tW; x++) {
      if (tpl.data[((y * tW + x) << 2) + 3] > 200) solidArr.push(x, y);
    }
    if (solidArr.length < 320) continue;
    let solid = Int32Array.from(solidArr);
    if (solid.length > 6000) {
      const picked: number[] = [];
      const stride = Math.ceil(solidArr.length / 6000) * 2;
      for (let s = 0; s < solidArr.length; s += stride) { picked.push(solidArr[s], solidArr[s + 1]); }
      solid = Int32Array.from(picked);
    }
    const cx = Math.round(best.fx * r.w), cy = Math.round(best.fy * r.h);
    for (let dy = -12; dy <= 12; dy += 2) {
      for (let dx = -12; dx <= 12; dx += 2) {
        const px = cx + dx, py = cy + dy;
        if (px < 0 || py < 0 || px + tW > r.w || py + tH > r.h) continue;
        const score = mad(orig2, tpl, solid, px, py, 45);
        if (score < best.score) best = { score, fw: tW / r.w, fh: tH / r.h, fx: px / r.w, fy: py / r.h };
      }
    }
  }
  if (best.score > 25) return null; // plausible match only below this MAD
  return { left: best.fx, top: best.fy, width: best.fw, height: best.fh };
}

/**
 * Where the account menu can take you. Ids must match WORKSPACE_TABS — the
 * dashboard reads the one left in sessionStorage on mount and switches to it.
 * An optional pane names the sub-tab to land on: "Recetas" is NOT the
 * top-level "recipes" tab (that is the Key Visuals grid, which has nothing a
 * human can add) — the copy recipes live inside Copywriting → Recetas.
 */
const EDITOR_NAV_TABS: Array<{ id: string; label: string; pane?: string }> = [
  { id: "diseno", label: "Diseño" },
  // v59: sin "Agentes" — la pestaña desapareció (Kanban/Tabla viven en Inicio).
  { id: "copywriting", label: "Copywriting" },
  { id: "contactos", label: "Contactos" },
  { id: "configuracion", label: "Configuración" },
  { id: "copywriting", label: "Recetas", pane: "recipes" },
  { id: "workspace", label: "Workspace" },
];

/** What the right-click mask commands act on: a closed path layer and the
 * image beneath it, resolved inside one frame's shadow content. */
interface ContextMenuMaskTarget {
  frameId: string;
  pathLayerId: string;
  imageLayerId: string;
  imageLayerName: string;
  mode: MaskMode | null;
}

/** Frame-space box of a layer inside #__df_content, via offset accumulation
 * (transform-proof, unlike getBoundingClientRect). */
function elementBoxInContent(el: Element, content: HTMLElement) {
  let left = 0;
  let top = 0;
  let node: Element | null = el;
  while (node && node !== content) {
    left += (node as HTMLElement).offsetLeft || 0;
    top += (node as HTMLElement).offsetTop || 0;
    node = (node as HTMLElement).offsetParent as Element | null;
  }
  if (node !== content) return null;
  return { left, top, width: (el as HTMLElement).offsetWidth || 0, height: (el as HTMLElement).offsetHeight || 0 };
}

/**
 * F1 detection: was this right click ON a closed bezier path that overlaps an
 * image in the same frame? The path becomes the mask source; the image it
 * covers most (by intersection area) is the mask target. Returns null when
 * the click offers no mask, and the menu then shows no selection block.
 */
function detectMaskTarget(event: MouseEvent): ContextMenuMaskTarget | null {
  const composed = typeof event.composedPath === "function" ? event.composedPath() : [];
  const pathEl = composed.find((node): node is Element => node instanceof Element && node.tagName.toLowerCase() === "path");
  if (!pathEl) return null;
  const d = (pathEl.getAttribute("d") || "").trim();
  if (!d || !/z\s*$/i.test(d)) return null; // only closed paths can select
  const svg = pathEl.closest("svg");
  const pathLayerId = svg?.getAttribute("data-layer-id");
  if (!svg || !pathLayerId) return null;
  const root = svg.getRootNode();
  if (!(root instanceof ShadowRoot)) return null;
  const content = root.getElementById("__df_content");
  const frameId = root.host?.getAttribute("data-frame-id");
  if (!content || !frameId) return null;
  const svgBox = elementBoxInContent(svg, content);
  if (!svgBox || svgBox.width <= 0 || svgBox.height <= 0) return null;
  let best: { id: string; name: string; area: number } | null = null;
  for (const img of Array.from(content.querySelectorAll("img[data-layer-id]"))) {
    const box = elementBoxInContent(img, content);
    if (!box) continue;
    const overlapW = Math.min(svgBox.left + svgBox.width, box.left + box.width) - Math.max(svgBox.left, box.left);
    const overlapH = Math.min(svgBox.top + svgBox.height, box.top + box.height) - Math.max(svgBox.top, box.top);
    const area = overlapW > 0 && overlapH > 0 ? overlapW * overlapH : 0;
    if (area > 0 && (!best || area > best.area)) {
      best = { id: img.getAttribute("data-layer-id") || "", name: img.getAttribute("data-layer-name") || "imagen", area };
    }
  }
  if (!best || !best.id) return null;
  const modeAttr = pathEl.getAttribute("data-mask-mode");
  return {
    frameId,
    pathLayerId,
    imageLayerId: best.id,
    imageLayerName: best.name,
    mode: modeAttr === "include" || modeAttr === "exclude" ? modeAttr : null,
  };
}

function PreviewReminderPopover({
  onOpen,
  onDismiss,
}: {
  onOpen: () => void;
  onDismiss: (days?: PreviewSnoozeDays) => Promise<void>;
}) {
  const [snoozeEnabled, setSnoozeEnabled] = useState(false);
  const [snoozeDays, setSnoozeDays] = useState<PreviewSnoozeDays>(1);
  const [savingSnooze, setSavingSnooze] = useState(false);
  const [snoozeError, setSnoozeError] = useState("");

  const dismiss = async () => {
    setSavingSnooze(true);
    setSnoozeError("");
    try {
      await onDismiss(snoozeEnabled ? snoozeDays : undefined);
    } catch {
      setSnoozeError("No pudimos guardar el recordatorio. Inténtalo otra vez.");
      setSavingSnooze(false);
    }
  };

  return (
    <div
      id="preview-reminder"
      role="region"
      aria-labelledby="preview-reminder-title"
      style={{
        position: "absolute",
        top: "calc(100% + 10px)",
        right: 0,
        zIndex: 120,
        width: 288,
        padding: 14,
        borderRadius: 10,
        border: "1px solid rgba(200,184,152,0.35)",
        background: "#151515",
        boxShadow: "0 12px 28px rgba(0,0,0,0.35)",
        color: "#e8e5dc",
      }}
    >
      <div id="preview-reminder-title" style={{ fontSize: 13, fontWeight: 650, marginBottom: 5 }}>Tu preview tiene cambios pendientes</div>
      <p style={{ margin: 0, color: "#aaa69a", fontSize: 12, lineHeight: 1.5 }}>
        El diseño cambió desde la última captura. Puedes actualizarlo desde Information.
      </p>
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 7, color: "#d2cec3", fontSize: 11, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={snoozeEnabled}
            onChange={event => setSnoozeEnabled(event.target.checked)}
          />
          No volver a recordarme temporalmente
        </label>
        <label htmlFor="preview-snooze-days" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, color: "#aaa69a", fontSize: 11 }}>
          Recordarme después de
          <select
            id="preview-snooze-days"
            value={snoozeDays}
            disabled={savingSnooze}
            onChange={event => {
              const days = Number(event.target.value);
              if (!isPreviewSnoozeDays(days)) return;
              setSnoozeDays(days);
              setSnoozeEnabled(true);
            }}
            style={{ background: "#202020", color: "#e8e5dc", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 5, padding: "3px 6px" }}
          >
            {PREVIEW_SNOOZE_DAYS.map(days => (
              <option key={days} value={days}>{days} {days === 1 ? "día" : "días"}</option>
            ))}
          </select>
        </label>
        {snoozeError && <div role="alert" style={{ marginTop: 8, color: "#fca5a5", fontSize: 11 }}>{snoozeError}</div>}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button type="button" className="editor-v2-topbar-btn" onClick={() => void dismiss()} disabled={savingSnooze}>
          {savingSnooze ? "Guardando…" : "Ahora no"}
        </button>
        <button type="button" className="editor-v2-topbar-btn" onClick={onOpen} disabled={savingSnooze} style={{ color: "#c8b898", borderColor: "rgba(200,184,152,0.45)" }}>
          Abrir Information
        </button>
      </div>
    </div>
  );
}

/** Full-canvas placeholder shown while the template JSON loads (shell-first
 *  boot). The chrome around it — topbar, back button — is already live; only
 *  the canvas waits. The spinning orb signals the fetch; the cached file name
 *  below tells the user WHICH file is opening so a misclick is undone fast. */
function CanvasBootSkeleton({ name }: { name: string }) {
  return (
    <div
      aria-busy="true"
      style={{
        position: "absolute", inset: 0, zIndex: 5,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 26,
        background: "#0a0a0a",
      }}
    >
      <div className="editor-boot-orb" aria-hidden="true">
        <span className="editor-boot-orb-core" />
      </div>
      <div className="editor-boot-pulse" style={{ color: "rgba(255,255,255,0.55)", fontSize: 13 }}>
        Cargando “{name}”…
      </div>
    </div>
  );
}

export function EditorV2({ templateId, onBack, onOpenTemplate }: EditorV2Props) {
  const { addToast } = useToast();
  const { user, signOut } = useAuth();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  // v60: el chip muestra a la persona — metadata de Supabase primero; el
  // email queda solo en «Sesión activa» del menú.
  const editorAccountName = resolveAccountName({
    metadataName: user?.user_metadata?.full_name || user?.user_metadata?.name,
    email: user?.email,
  });
  // ── DocumentStore (transactional single source of truth, replaces 77 manual pushUndo calls) ──
  const storeRef = useRef<DocumentStore | null>(null);
  if (!storeRef.current) storeRef.current = createDocumentStore();
  const store = storeRef.current;
  // QA probe: verification agents inspect undo depth / frames without guessing.
  if (typeof window !== "undefined") (window as any).__docStore = store;
  const frames = useSyncExternalStore(store.subscribe, store.getSnapshot) as FrameData[];
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [templateName, setTemplateName] = useState("New Design");
  const [templateWorkspaceId, setTemplateWorkspaceId] = useState("default");
  const [activeTool, setActiveTool] = useState<HtmlToolName>("select");
  // F4 A2: layer currently in vertex-edit mode (drives the topbar chip).
  const [vertexEditModeLayer, setVertexEditModeLayer] = useState<string | null>(null);
  const [brushSize, setBrushSize] = useState(24); // F4 Borrador diameter in px
  const [wandBusy, setWandBusy] = useState<string | null>(null); // F2 Varita: image being segmented (inline loader)
  const [wandPrompt, setWandPrompt] = useState(""); // F2b CLIPSeg text prompt ("la persona")
  const [foregroundColor, setForegroundColor] = useState("#000000");
  const [backgroundColor, setBackgroundColor] = useState("#ffffff");
  const [zoom, setZoom] = useState(0.5);
  const [editingZoomTopbar, setEditingZoomTopbar] = useState(false);
  const [rightPanelWidth, setRightPanelWidth] = useState(270);
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const handleRightPanelResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizeStateRef.current = { startX: e.clientX, startWidth: rightPanelWidth };
    const onMove = (ev: MouseEvent) => {
      if (!resizeStateRef.current) return;
      const delta = resizeStateRef.current.startX - ev.clientX;
      const next = Math.min(560, Math.max(220, resizeStateRef.current.startWidth + delta));
      setRightPanelWidth(next);
    };
    const onUp = () => {
      resizeStateRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [rightPanelWidth]);
  // Sprint 3.5: auto-edit newly created text layers
  const [autoEditLayerId, setAutoEditLayerId] = useState<string | null>(null);

  // Agent bridge: window.futurariaAgent gives AI agents frame snapshots + layout lint
  useEffect(() => { installAgentBridge(); }, []);

  // ── Sync canUndo/canRedo from DocumentStore ──
  useEffect(() => {
    const unsubscribe = store.subscribe(() => {
      setCanUndo(store.canUndo);
      setCanRedo(store.canRedo);
    });
    // Initial sync
    setCanUndo(store.canUndo);
    setCanRedo(store.canRedo);
    return unsubscribe;
  }, [store]);

  // ── UI state ──
  // loadingRef mirrors `loading` for callbacks registered once (autoSave,
  // keyboard, beforeunload, realtime): with the shell-first boot the chrome
  // renders before the template arrives, so every persistence path must be
  // able to check it synchronously and refuse to save an empty document
  // over the real one.
  const [loading, setLoadingState] = useState(true);
  const loadingRef = useRef(true);
  const setLoading = useCallback((v: boolean) => {
    loadingRef.current = v;
    setLoadingState(v);
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const lastPushTimeRef = useRef(0);
  const [selectedFont, setSelectedFont] = useState("");
  const [showFontPicker, setShowFontPicker] = useState(false);
  const [editingTemplateName, setEditingTemplateName] = useState<string | null>(null);
  const templateNameInputRef = useRef<HTMLInputElement>(null);
  const [activeAgents, setActiveAgents] = useState<{ agentId: string; sectionId: string; onlineAt: string }[]>([]);
  const realtimeChannelRef = useRef<RealtimeChannel | null>(null);
  const presenceChannelRef = useRef<RealtimeChannel | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastRemoteUpdateRef = useRef<string | null>(null);
  const isDirtyRef = useRef(false);
  // Generación del documento local: cada autoSave (edición, undo, redo) la
  // incrementa. Un PUT en vuelo solo es "la verdad" si su generación sigue
  // siendo la más nueva — esto evita que un guardado viejo complete DESPUÉS
  // de un Ctrl+Z, marque el documento como limpio y el polling de 5s
  // reaplique el estado pre-undo revergiendo tu deshacer.
  const docGenerationRef = useRef(0);
  const autoSaveRef = useRef<(frames: FrameData[]) => void>(() => {});
  const framesRef = useRef(frames);
  framesRef.current = frames;
  const lastPenStyleRef = useRef<PenStyle>({
    fill: "none",
    stroke: "#111827",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeDasharray: "none",
  });

  // When foreground color changes, update the pen style fill
  useEffect(() => {
    lastPenStyleRef.current = { ...lastPenStyleRef.current, fill: foregroundColor };
  }, [foregroundColor]);

  // ── Selected element (inside a frame) ──
  const [selectedElement, setSelectedElement] = useState<SelectedElementInfo | null>(null);
  const [layerSelectionRequest, setLayerSelectionRequest] = useState<LayerSelectionRequest | null>(null);
  const layerSelectionSequenceRef = useRef(0);
  const [showRightPanel, setShowRightPanel] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<string>("contextual");
  // Topbar legibility (Fase 1): grouped menus replace the emoji-only IA row
  // and the canvas-toggle row — one trigger + named entries each.
  const [showAiMenu, setShowAiMenu] = useState(false);
  const [showViewMenu, setShowViewMenu] = useState(false);
  const [showEditorMenu, setShowEditorMenu] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [showMorePanels, setShowMorePanels] = useState(false);
  const [designUpdatedAt, setDesignUpdatedAt] = useState<string | null>(null);
  const [coverCapturedAt, setCoverCapturedAt] = useState<string | null>(null);
  const [previewSnoozedUntil, setPreviewSnoozedUntil] = useState<string | null>(null);
  const [previewMetaLoaded, setPreviewMetaLoaded] = useState(false);
  const [showPreviewReminder, setShowPreviewReminder] = useState(false);
  const [reminderDismissedThisVisit, setReminderDismissedThisVisit] = useState(false);
  const [emphasizePreviewCapture, setEmphasizePreviewCapture] = useState(false);
  const toggleRightPanel = (tab: string) => {
    if (showRightPanel && rightPanelTab === tab) setShowRightPanel(false);
    else { setRightPanelTab(tab); setShowRightPanel(true); }
  };
  // ── BUG-1: con el panel derecho abierto, el FAB del chat (fixed z-9100,
  // right:88) caía encima de los controles bajos del panel (Font/Size/Fill).
  // El FAB lee su `right` de esta var CSS; con panel abierto se corre a la
  // izquierda del panel, sobre el canvas, donde no tapa nada. ──
  useEffect(() => {
    if (showRightPanel) document.body.style.setProperty("--musa-fab-right", "306px");
    else document.body.style.removeProperty("--musa-fab-right");
    return () => { document.body.style.removeProperty("--musa-fab-right"); };
  }, [showRightPanel]);
  // BUG-24: Delete con un frame seleccionado (sin elemento) armaba la
  // eliminación del frame entero en un pulso. Primer Delete arma, segundo
  // dentro de 2.5s confirma; cualquier re-selección desarma.
  const frameDeleteArmRef = useRef(0);
  const openPreviewCaptureGuide = useCallback(() => {
    setReminderDismissedThisVisit(true);
    setShowPreviewReminder(false);
    setShowMorePanels(false);
    setRightPanelTab("meta");
    setShowRightPanel(true);
    setEmphasizePreviewCapture(true);
  }, []);
  const handleCoverUpdated = useCallback((capturedAt: string) => {
    setCoverCapturedAt(capturedAt);
    setPreviewSnoozedUntil(null);
    setShowPreviewReminder(false);
    setEmphasizePreviewCapture(false);
  }, []);
  // Fail-safe below 1536px: the panel cluster collapses into a single "⋯"
  // menu, so no panel is ever inaccessible on smaller desktops. 1536 is the
  // common 1920-screen-at-125%-scaling width — the last width where the
  // full labeled cluster still crowds out the user chip.
  const [isNarrowTopbar, setIsNarrowTopbar] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1535px)");
    const apply = () => setIsNarrowTopbar(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  // Sub-tabs of the "contextual" page specifically — whatever is currently
  // selected (an element or a frame), Properties/Code/Animation all inspect
  // THAT same selection, just from a different angle.
  const [contextualSubTab, setContextualSubTab] = useState<"properties" | "code" | "animation">("properties");
  // Opens the Properties panel's Code sub-tab — the single place code now
  // lives (the old left-docked Code Panel toolbar button showed the exact
  // same html/css/handlers as this tab, so it was removed as a duplicate).
  const openCodeTab = useCallback(() => {
    if (showRightPanel && rightPanelTab === "contextual" && contextualSubTab === "code") {
      setShowRightPanel(false);
      return;
    }
    setRightPanelTab("contextual");
    setContextualSubTab("code");
    setShowRightPanel(true);
  }, [showRightPanel, rightPanelTab, contextualSubTab]);
  const [multiSelectLayerIds, setMultiSelectLayerIds] = useState<string[]>([]);
    // Cross-frame element selection, parallel to multiSelectLayerIds (which
    // stays frame-local so every existing handler keeps its semantics).
    // Ctrl+click accumulates layers across frames; the align buttons consume it.
    const [crossFrameTargets, setCrossFrameTargets] = useState<Array<{ frameId: string; layerId: string }>>([]);
  const [canvasObjects, setCanvasObjects] = useState<HtmlCanvasObject[]>([]);
  const canvasObjectsRef = useRef(canvasObjects);
  canvasObjectsRef.current = canvasObjects;
  // ── REQ-022 zero-frame empty state: same social-format picker as the
  // dashboard's new-file popup, so recovering from an empty file offers the
  // exact dimensions instead of dragging a mystery box. ──
  const [emptyFormatId, setEmptyFormatId] = useState(SOCIAL_FORMATS[0]?.id ?? CUSTOM_FORMAT_ID);
  const [emptyW, setEmptyW] = useState(String(SOCIAL_FORMATS[0]?.width ?? 1080));
  const [emptyH, setEmptyH] = useState(String(SOCIAL_FORMATS[0]?.height ?? 1080));
  const [showSvgImport, setShowSvgImport] = useState(false);

  // ── Comments (Supabase design_comments) + public/private share toggle ──
  const [comments, setComments] = useState<CanvasCommentPin[]>([]);
  const [showComments, setShowComments] = useState(true); // desktop: pins on/off
  const [commentMode, setCommentMode] = useState(false); // mobile: single tap = comment
  const [isPublic, setIsPublic] = useState(false); // fail-closed: private by default for ALL designs (v50)
  const [publicBusy, setPublicBusy] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [commentComposer, setCommentComposer] = useState<{ world: { x: number; y: number }; screen: { x: number; y: number } } | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentSaving, setCommentSaving] = useState(false);
  const [highlightCommentId, setHighlightCommentId] = useState<string | null>(null);

  // ── Figma-style selection state ──
  const [selectedFrameIds, setSelectedFrameIds] = useState<Set<string>>(new Set());
  const [contentFrameId, setContentFrameId] = useState<string | null>(null);
  const [selectedOrphanIds, setSelectedOrphanIds] = useState<Set<string>>(new Set());
  // ── Musa Hands (REQ Gesture Mode) ──
  // Gesture actions fire at 30fps and read the live selection through refs:
  // no stale closures, and the gesture effect never re-arms (no camera
  // blink) when the selection changes.
  const [gestureOn, setGestureOn] = useState(false);
  const zoomRef = useRef(zoom);
  const selectedFrameIdRef = useRef<string | null>(selectedFrameId);
  const selectedOrphanIdsRef = useRef(selectedOrphanIds);
  zoomRef.current = zoom;
  selectedFrameIdRef.current = selectedFrameId;
  selectedOrphanIdsRef.current = selectedOrphanIds;

  // ── Derived: active frame ──
  const selectedFrame = frames.find(f => f.id === selectedFrameId) ?? null;
  const activeHtml = selectedFrame?.html ?? DEFAULT_HTML;
  const activeCss = selectedFrame?.css ?? DEFAULT_CSS;

  // ── Undo/Redo via DocumentStore ──
  // canUndo/canRedo derived from store, synced via useEffect below

  const handleUndo = useCallback(() => {
    if (!store.canUndo) return;
    const success = store.undo();
    if (!success) return;
    const cur = store.frames as FrameData[];
    const restoredObjects = store.canvasObjects as HtmlCanvasObject[];
    canvasObjectsRef.current = restoredObjects;
    setCanvasObjects(restoredObjects);
    lastPushTimeRef.current = 0;
    setSelectedElement(null);
    setContentFrameId(cid => cid && cur.some(f => f.id === cid) ? cid : null);
    setSelectedFrameId(cid => cid && cur.some(f => f.id === cid) ? cid : cur[0]?.id ?? null);
    setSelectedFrameIds(current => {
      const valid = new Set([...current].filter(id => cur.some(f => f.id === id)));
      if (valid.size === 0 && cur[0]) valid.add(cur[0].id);
      return valid;
    });
    isDirtyRef.current = true;
    autoSaveRef.current(cur);
  }, [store]);

  const handleRedo = useCallback(() => {
    if (!store.canRedo) return;
    const success = store.redo();
    if (!success) return;
    const cur = store.frames as FrameData[];
    const restoredObjects = store.canvasObjects as HtmlCanvasObject[];
    canvasObjectsRef.current = restoredObjects;
    setCanvasObjects(restoredObjects);
    lastPushTimeRef.current = 0;
    setSelectedElement(null);
    setContentFrameId(cid => cid && cur.some(f => f.id === cid) ? cid : null);
    setSelectedFrameId(cid => cid && cur.some(f => f.id === cid) ? cid : cur[0]?.id ?? null);
    setSelectedFrameIds(current => {
      const valid = new Set([...current].filter(id => cur.some(f => f.id === id)));
      if (valid.size === 0 && cur[0]) valid.add(cur[0].id);
      return valid;
    });
    isDirtyRef.current = true;
    autoSaveRef.current(cur);
  }, [store]);

  // ── Swap foreground / background colors ──
  const handleSwapColors = useCallback(() => {
    const fg = foregroundColor;
    const bg = backgroundColor;
    setForegroundColor(bg);
    setBackgroundColor(fg);
  }, [foregroundColor, backgroundColor]);

  // ── Fase 2: boot identity — name from the dashboard's list cache ──
  // Best-effort hydration so the topbar and the canvas skeleton show WHICH
  // file is opening before the fetch resolves. The server response overwrites
  // it with authoritative data on arrival.
  useEffect(() => {
    try {
      const raw = localStorage.getItem("futuraria-tpl-cache-v1");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const hit = Array.isArray(parsed?.data)
        ? parsed.data.find((t: any) => t?.id === templateId)
        : null;
      if (hit?.name) setTemplateName(hit.name);
    } catch { /* cache is best-effort */ }
  }, [templateId]);

  // ── Load template → parse into frames ──
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const tpl = await getTemplate(templateId);
        if (cancelled) return;
        if (!tpl) { setError("Template not found"); setLoading(false); return; }
        const t = tpl as any;
        if (t.engine && t.engine !== "html") {
          setError("This template uses an unsupported engine. Only HTML templates are supported.");
          setLoading(false);
          return;
        }
        setTemplateName(t.name || "Untitled");
        setDesignUpdatedAt(t.metadata?.contentUpdatedAt || t.metadata?.updatedAt || null);
        if (t.workspaceId) setTemplateWorkspaceId(t.workspaceId);
        // Doc del timeline (Video Mode v2) — tolerante a ausencia. El store
        // carga además su journal persistente para deshacer tras recargar.
        const vtd = normalizeVideoTimelineDoc((t as any).videoTimeline);
        videoTimelineRef.current = vtd;
        videoDocStore.syncFromTemplate(templateId, vtd);

        // Multi-frame support: frames[] is the source of truth. An EMPTY array
        // is a valid zero-frame file (REQ-022) — loading it must not resurrect
        // a phantom 1080×1080 frame. Only templates WITHOUT the key fall back
        // to the legacy single-frame shape.
        if (t.frames && Array.isArray(t.frames)) {
          const loaded: FrameData[] = t.frames.map((f: any, i: number) => {
            // Legacy designs repeat data-layer-id across elements; normalize
            // before anything addresses a layer by id (see dedupeLayerIds).
            const unique = dedupeLayerIds(f.html || "", f.css || "", createLayerId);
            return {
              id: f.id || `frame_${i}`,
              name: f.name || `Frame ${i + 1}`,
              x: f.x ?? (i * ((f.width || 1080) + FRAME_GAP)),
              y: f.y ?? 0,
              width: f.width || t.width || 1080,
              height: f.height || t.height || 1080,
              html: ensureLayerIds(unique.html, createLayerId, unique.css),
              css: unique.css,
              background: f.background || "#ffffff",
              // Reel/animation state (REQ-035): autosave persists the full
              // FrameData — dropping these here silently reset takes to 5s
              // defaults and wiped transitions/filters/fx on every reload.
              animation: f.animation ?? undefined,
              reelExcluded: f.reelExcluded ?? undefined,
              reelFilter: f.reelFilter ?? undefined,
              reelLayout: f.reelLayout ?? undefined,
              reelFx: f.reelFx ?? undefined,
              reelOverlayFx: Array.isArray(f.reelOverlayFx) ? f.reelOverlayFx : undefined,
              reelParticles: f.reelParticles ?? undefined,
            };
          });
          store.replaceAll(loaded);
          setSelectedFrameId(loaded[0]?.id ?? null);
          // Loaded data is the baseline, not an undoable user action.
          lastPushTimeRef.current = 0;
          setCanUndo(false);
          setCanRedo(false);
        } else {
          // Legacy: single template → one frame
          const unique = dedupeLayerIds(t.html || DEFAULT_HTML, t.css || DEFAULT_CSS, createLayerId);
          const single: FrameData = {
            id: "frame_0",
            name: t.name || "Frame 1",
            x: 0, y: 0,
            width: t.width || 1080,
            height: t.height || 1080,
            html: ensureLayerIds(unique.html, createLayerId, unique.css),
            css: unique.css,
            background: "#ffffff",
          };
          store.replaceAll([single]);
          setSelectedFrameId(single.id);
          // Loaded data is the baseline, not an undoable user action.
          lastPushTimeRef.current = 0;
          setCanUndo(false);
          setCanRedo(false);
        }
        const loadedCanvasObjects = Array.isArray(t.canvasObjects)
          ? t.canvasObjects.map((object: any, index: number) => normalizeCanvasObject(object, index))
          : [];
        canvasObjectsRef.current = loadedCanvasObjects;
        setCanvasObjects(loadedCanvasObjects);
        store.replaceCanvasObjects(loadedCanvasObjects);
      } catch (err: any) {
        if (!cancelled) setError(err.message || "Failed to load template");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [templateId]);

  useEffect(() => {
    let cancelled = false;
    setReminderDismissedThisVisit(false);
    setShowPreviewReminder(false);
    setPreviewMetaLoaded(false);
    fetch(`/api/meta/${templateId}`, { headers: getApiHeaders() })
      .then(response => {
        if (!response.ok) throw new Error(`Preview metadata failed (${response.status})`);
        return response.json();
      })
      .then(result => {
        if (cancelled) return;
        setCoverCapturedAt(result?.data?.cover_captured_at || null);
        setPreviewSnoozedUntil(result?.data?.preview_snoozed_until || null);
        if (result?.data?.content_updated_at) setDesignUpdatedAt(result.data.content_updated_at);
        setPreviewMetaLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setPreviewMetaLoaded(false);
      });
    return () => { cancelled = true; };
  }, [templateId]);

  useEffect(() => {
    if (!previewMetaLoaded || !designUpdatedAt || reminderDismissedThisVisit) return;
    setShowPreviewReminder(shouldShowPreviewReminder({
      designUpdatedAt,
      coverCapturedAt,
      snoozedUntil: previewSnoozedUntil,
    }));
  }, [previewMetaLoaded, designUpdatedAt, coverCapturedAt, previewSnoozedUntil, reminderDismissedThisVisit]);

  const dismissPreviewReminder = useCallback(async (days?: PreviewSnoozeDays) => {
    if (days) {
      const result = await apiFetch<any>(`/api/meta/${templateId}/preview-reminder`, {
        method: "PUT",
        body: JSON.stringify({ days }),
      });
      setPreviewSnoozedUntil(result.data.snoozed_until);
    }
    setReminderDismissedThisVisit(true);
    setShowPreviewReminder(false);
  }, [templateId]);

  // ── Auto-save (immediate localStorage, debounced API sync) ──
  const autoSave = useCallback((updatedFrames: FrameData[]) => {
    // Shell-first boot: until the template lands the store is empty, and a
    // save here would write an empty payload stamped as "newest" — which
    // templateApi prefers over the server on the next getTemplate.
    if (loadingRef.current) return;
    // Bump de generación: cualquier payload agendado antes de este punto
    // queda obsoleto (su timer será reemplazado por el de abajo).
    const gen = ++docGenerationRef.current;
    const active = updatedFrames.find(f => f.id === selectedFrameId) || updatedFrames[0];

    // Compute content hash + attribution for change tracking
    const hashedFrames = updatedFrames.map(f => ({
      ...f,
      contentHash: simpleHash((f.html || "") + "||" + (f.css || "")),
      lastModifiedBy: "human",
      lastModifiedAt: new Date().toISOString(),
    }));

    const payload = {
      frames: hashedFrames,
      canvasObjects: canvasObjectsRef.current,
      videoTimeline: videoTimelineRef.current,
      html: active?.html || "",
      css: active?.css || "",
      name: templateName,
    };

    // ✅ Immediate localStorage write (synchronous — survives refresh/tab close)
    try {
      saveLocal(templateId, payload);
    } catch (localErr) {
      console.error("[SAVE] localStorage FAILED:", localErr);
      addToast("Error crítico: no se pudo guardar localmente. Verifica el espacio disponible.", "error", true);
    }

    // ✅ Mark as dirty so polling won't overwrite our state
    isDirtyRef.current = true;

    // ✅ Debounced API sync (2s)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      // Un cambio (edición, undo, redo) posterior a este timer hace obsoleto
      // este payload: el autoSave más nuevo ya agendó el suyo. Salir SIN
      // escribir nada — ni siquiera abrimos el servidor ni parpadea "guardando".
      if (gen !== docGenerationRef.current) return;
      setSaving(true);

      // Sync to API + Supabase with exponential-backoff retry (max 3 attempts)
      const MAX_RETRIES = 3;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (gen !== docGenerationRef.current) break; // quedó obsoleto en pleno vuelo
        try {
          const putRes = await apiFetch(`/api/templates/${templateId}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          });
          // Solo la generación más nueva declara limpio el documento y
          // transmite por realtime: si un undo aterrizó mientras este PUT
          // estaba en vuelo, isDirty sigue en true y el polling NO puede
          // bajar de la BD el estado pre-undo para reverir tu deshacer.
          if (gen === docGenerationRef.current) {
            broadcastChange(realtimeChannelRef.current, templateId, active?.id || "", active?.html || "", active?.css || "");
            lastBroadcastRef.current = { html: active?.html || "", css: active?.css || "" };
            retryCountRef.current = 0;
            isDirtyRef.current = false;
          }
          break;
        } catch (err) {
          console.error(`[SAVE] API PUT attempt ${attempt + 1}/${MAX_RETRIES + 1} FAILED:`, err);
          retryCountRef.current = attempt + 1;
          if (attempt < MAX_RETRIES) {
            const delay = Math.pow(2, attempt) * 1000;
            await new Promise(r => setTimeout(r, delay));
          } else {
            console.error("[SAVE] Auto-save exhausted retries (cached in localStorage):", err);
            addToast("No se pudieron sincronizar los cambios con el servidor. Guardados localmente.", "error");
          }
        }
      }
      setSaving(false);
    }, 2000);
  }, [templateId, selectedFrameId, templateName, addToast]);

  // Keep autoSaveRef in sync so undo/redo can call the latest version
  autoSaveRef.current = autoSave;

  /**
   * Explicit save (Ctrl/⌘+S or the Save button): flush whatever the debounce
   * is holding, then mark a permanent version. Marked versions are never
   * rotated away, unlike the automatic ones.
   */
  const [savingVersion, setSavingVersion] = useState(false);

  const handleSignOut = useCallback(async () => {
    setUserMenuOpen(false);
    await signOut();
    window.location.href = "/";
  }, [signOut]);

  const handleSaveVersion = useCallback(async () => {
    if (savingVersion) return;
    setSavingVersion(true);
    try {
      // ── Phase 1: Save frames to server (blocking — this MUST succeed) ──
      if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
      // Mid-burst Ctrl+S: React may not have committed the last frame write
      // yet, so the chain (if a burst is in flight) is fresher than framesRef.
      const currentFrames = framesChainRef.current ?? framesRef.current;
      const active = currentFrames.find(f => f.id === selectedFrameId) || currentFrames[0];
      const payload = {
        frames: currentFrames.map(f => ({
          ...f,
          contentHash: simpleHash((f.html || "") + "||" + (f.css || "")),
          lastModifiedBy: "human",
          lastModifiedAt: new Date().toISOString(),
        })),
        canvasObjects: canvasObjectsRef.current,
        videoTimeline: videoTimelineRef.current,
        html: active?.html || "",
        css: active?.css || "",
        name: templateName,
      };
      // Manual save mirrors autoSave's localStorage contract: a refresh right
      // after Ctrl+S must find the saved state, not the last debounced copy.
      try { saveLocal(templateId, payload); } catch { /* localStorage lleno/roto: el PUT manda */ }
      await apiFetch(`/api/templates/${templateId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      isDirtyRef.current = false;

      // ── Phase 2: Create version snapshot (non-blocking — bonus, not required) ──
      try {
        const res = await apiFetch<any>(`/api/templates/${templateId}/versions`, {
          method: "POST",
          body: JSON.stringify({ kind: "marked", label: "Guardado manual" }),
        });
        if (res?.data) {
          addToast("Versión guardada en el historial.", "success");
        } else {
          addToast("Diseño guardado correctamente.", "success");
        }
      } catch {
        // Frames saved successfully — version creation is a bonus feature.
        addToast("Diseño guardado correctamente.", "success");
      }
      window.dispatchEvent(new Event("futuraria-version-saved"));
    } catch (err: any) {
      addToast(`No se pudo guardar el diseño: ${err?.message || "error de conexión"}`, "error");
    }
    setSavingVersion(false);
  }, [savingVersion, templateId, selectedFrameId, templateName, addToast]);

  const commitCanvasObjects = useCallback((next: HtmlCanvasObject[], updatedFrames = framesRef.current, label = "edit object") => {
    store.replaceDocumentWithUndo(updatedFrames, next, label);
    canvasObjectsRef.current = next;
    setCanvasObjects(next);
    autoSave(updatedFrames);
  }, [autoSave, store]);

  // ── Comments: mobile detection (two-button bar) ──
  // v61.2 — solo por ancho: una laptop o tablet táctil grande es escritorio
  // (toolbar y paneles intactos); el modo phone llega debajo de 768px.
  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 768);
    update();
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
    };
  }, []);

  // ── Comments: the design-space bounds pct coords map onto ──
  // Same idea as the mobile share preview (which uses template width/height):
  // a pin at 50%/50% lands on the center of the union bbox of frames+orphans.
  const commentBounds = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const f of frames) {
      minX = Math.min(minX, f.x); minY = Math.min(minY, f.y);
      maxX = Math.max(maxX, f.x + f.width); maxY = Math.max(maxY, f.y + f.height);
    }
    for (const o of canvasObjects) {
      minX = Math.min(minX, o.x); minY = Math.min(minY, o.y);
      maxX = Math.max(maxX, o.x + o.width); maxY = Math.max(maxY, o.y + o.height);
    }
    if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 1080, height: 1080 };
    return { x: minX, y: minY, width: Math.max(maxX - minX, 1), height: Math.max(maxY - minY, 1) };
  }, [frames, canvasObjects]);

  // ── Comments: load from Supabase (design_comments) + 30s poll ──
  const loadComments = useCallback(async () => {
    try {
      const json = await apiFetch<any>(`/api/templates/${templateId}/comments`);
      if (json?.success && Array.isArray(json.data)) {
        setComments(json.data.map((c: any): CanvasCommentPin => ({
          id: c.id,
          xPct: Number(c.x_pct) || 0,
          yPct: Number(c.y_pct) || 0,
          body: c.body || "",
          authorName: c.author_name || "",
          status: c.status || "open",
          source: c.source || "mobile_pin",
          createdAt: c.created_at || "",
          kanbanTaskId: c.kanban_task_id || null,
        })));
      }
    } catch { /* offline — keep the last known pins on screen */ }
  }, [templateId]);

  useEffect(() => {
    void loadComments();
  }, [loadComments]);

  // ── Comments: load the public/private flag (fail-open until v28) ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const json = await apiFetch<any>(`/api/templates/${templateId}/public`);
        if (!cancelled && json?.success && typeof json.data?.isPublic === "boolean") {
          setIsPublic(json.data.isPublic);
        }
      } catch { /* pre-migration or offline — stay fail-open */ }
    })();
    return () => { cancelled = true; };
  }, [templateId]);

  // ── Comments: double-tap / double-click / comment-mode tap → composer ──
  const handleCommentRequest = useCallback((req: { world: { x: number; y: number }; screen: { x: number; y: number } }) => {
    setCommentComposer({ world: req.world, screen: req.screen });
    setCommentDraft("");
    setCommentMode(false);
  }, []);

  const handleCommentSave = useCallback(async () => {
    const text = commentDraft.trim();
    if (!text || !commentComposer) return;
    setCommentSaving(true);
    try {
      const b = commentBounds;
      const xPct = Math.max(0, Math.min(100, ((commentComposer.world.x - b.x) / b.width) * 100));
      const yPct = Math.max(0, Math.min(100, ((commentComposer.world.y - b.y) / b.height) * 100));
      await apiFetch<any>(`/api/templates/${templateId}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: text, xPct, yPct }),
      });
      setCommentComposer(null);
      setCommentDraft("");
      void loadComments();
      addToast("Comentario guardado.", "success");
    } catch (err: any) {
      addToast(err?.message || "No se pudo guardar el comentario.", "error");
    } finally {
      setCommentSaving(false);
    }
  }, [commentDraft, commentComposer, commentBounds, templateId, loadComments, addToast]);

  // ── Comments: pin CRUD — the popover (and the panel) drive these ──
  const handleCommentPinMove = useCallback(async (commentId: string, xPct: number, yPct: number) => {
    try {
      await apiFetch<any>(`/api/templates/${templateId}/comments/${commentId}`, {
        method: "PATCH",
        body: JSON.stringify({ xPct, yPct }),
      });
      void loadComments();
    } catch { /* offline — the poll will reconcile */ }
  }, [templateId, loadComments]);

  const handleCommentEdit = useCallback(async (commentId: string, body: string) => {
    try {
      await apiFetch<any>(`/api/templates/${templateId}/comments/${commentId}`, {
        method: "PATCH",
        body: JSON.stringify({ body }),
      });
      void loadComments();
    } catch { /* panel keeps working with the last known rows */ }
  }, [templateId, loadComments]);

  const handleCommentToKanban = useCallback(async (commentId: string) => {
    try {
      const json = await apiFetch<any>(`/api/templates/${templateId}/comments/${commentId}/kanban`, {
        method: "POST",
      });
      if (json?.success) {
        void loadComments();
        addToast(json.already ? "El comentario ya estaba en el Kanban." : "Comentario añadido al Kanban como tarea.", "success");
      }
    } catch (err: any) {
      addToast(err?.message || "No se pudo añadir al Kanban.", "error");
    }
  }, [templateId, loadComments, addToast]);

  const handleResolveComment = useCallback(async (commentId: string, status: "open" | "resolved" = "resolved") => {
    try {
      await apiFetch<any>(`/api/templates/${templateId}/comments/${commentId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      void loadComments();
    } catch { /* panel keeps working with the last known rows */ }
  }, [templateId, loadComments]);

  const handleDeleteComment = useCallback(async (commentId: string) => {
    try {
      await apiFetch<any>(`/api/templates/${templateId}/comments/${commentId}`, { method: "DELETE" });
      void loadComments();
    } catch { /* 404 = already gone; the poll will catch up */ }
  }, [templateId, loadComments]);

  // ── Comments: public/private share toggle (PATCH /public) ──
  const handleTogglePublic = useCallback(async () => {
    if (publicBusy) return;
    setPublicBusy(true);
    const next = !isPublic;
    try {
      const json = await apiFetch<any>(`/api/templates/${templateId}/public`, {
        method: "PATCH",
        body: JSON.stringify({ isPublic: next }),
      });
      if (json?.success) setIsPublic(json.data?.isPublic === true);
      addToast(next
        ? "Tu diseño ahora es público: cualquiera con el enlace puede dejar comentarios."
        : "Tu diseño ahora es privado: el enlace deja de funcionar para los invitados.",
        "success");
    } catch (err: any) {
      addToast(err?.message || "No se pudo cambiar la visibilidad.", "error");
    } finally {
      setPublicBusy(false);
    }
  }, [isPublic, publicBusy, templateId, addToast]);

  // ── Flush pending save on tab close / navigation ──
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (loadingRef.current) return; // boot not finished — nothing valid to flush
      if (isDirtyRef.current && saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        // Sync: send last known state via sendBeacon (fire-and-forget)
        const lastFrames = framesRef.current;
        const active = lastFrames.find(f => f.id === selectedFrameId) || lastFrames[0];
        const payload = JSON.stringify({
          frames: lastFrames.map(f => ({...f, contentHash: simpleHash((f.html || "") + "||" + (f.css || "")), lastModifiedBy: "human", lastModifiedAt: new Date().toISOString()})),
          canvasObjects: canvasObjectsRef.current,
          videoTimeline: videoTimelineRef.current,
          html: active?.html || "",
          css: active?.css || "",
          name: templateName,
        });
        try { navigator.sendBeacon(`/api/templates/${templateId}`, new Blob([payload], { type: "application/json" })); } catch {}
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [templateId, selectedFrameId, templateName]);

  // AI/remote-authored content can arrive pre-grouped — an agent composing a
  // few related elements (a photo + its caption, an icon + label) naturally
  // wraps them in one group, the same shorthand a human would reach for. But
  // this app's default is a flat layer list: every meaningful object
  // independently selectable and movable. Whenever a frame's html changes
  // from OUTSIDE this session (an MCP tool call, another collaborator), find
  // any TOP-LEVEL group wrapper in the new html and dissolve it the exact
  // same safe way the user's own "Ungroup" button does — bake each child's
  // live RENDERED position onto it before removing the wrapper, so nothing
  // shifts. Only top-level: a legitimately compound object (an icon built
  // from nested paths) keeps its internal structure.
  const autoUngroupIncomingFrame = useCallback((frameId: string) => {
    // Two rAFs: the first commits the state update, the second waits for
    // the browser to have actually painted the new html so getBoundingClientRect
    // reflects it — measuring one frame too early reads the STALE layout.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const frame = (framesRef.current as FrameData[]).find(f => f.id === frameId);
        if (!frame) return;
        const doc = new DOMParser().parseFromString(frame.html, "text/html");
        const topGroups = [...doc.body.children].filter(el => el.getAttribute("data-layer-kind") === "group");
        if (topGroups.length === 0) return;
        let html = frame.html;
        for (const el of topGroups) {
          const layerId = el.getAttribute("data-layer-id");
          if (!layerId) continue;
          const bake = measureContainerForBake(frameId, layerId);
          if (!bake) continue; // not rendered yet / not found — leave it grouped rather than guess
          const next = ungroupPreservingLayout(html, bake);
          if (next) html = next;
        }
        if (html === frame.html) return;
        const updated = (framesRef.current as FrameData[]).map(f => f.id === frameId ? { ...f, html } : f);
        store.replaceAll(updated);
        autoSave(updated);
      });
    });
  }, [autoSave]);

  // ── Realtime sync ──
  const realtimeReadyRef = useRef(false);
  const lastBroadcastRef = useRef<{ html: string; css: string } | null>(null);

  useEffect(() => {
    realtimeReadyRef.current = false; // Reset on re-mount
    const channel = subscribeTemplate(templateId, (remoteFrameId, newHtml, newCss) => {
      // Skip the initial callback fired when the channel is first joined
      if (!realtimeReadyRef.current) {
        realtimeReadyRef.current = true;
        return;
      }
      // Shell-first boot: the store is still empty — applying a remote frame
      // here would build a 1-frame ghost that load() then discards.
      if (loadingRef.current) return;
      const targetFrameId = remoteFrameId || selectedFrameId;
      if (!targetFrameId) return;
      // Ignore our own broadcasts
      if (lastBroadcastRef.current &&
          lastBroadcastRef.current.html === newHtml &&
          lastBroadcastRef.current.css === newCss) {
        return;
      }
      const curFrames = store.frames as FrameData[];
      store.replaceAll(curFrames.map(f =>
        f.id === targetFrameId
          ? { ...f, html: newHtml, css: newCss }
          : f
      ));
      autoUngroupIncomingFrame(targetFrameId);
    });
    if (channel) {
      realtimeChannelRef.current = channel;
    } else {
      pollingRef.current = setInterval(async () => {
        // ✅ Guard: skip polling entirely if we have unsaved local changes
        if (isDirtyRef.current) {
          return;
        }
        // Shell-first boot: nothing to diff against until the template lands.
        if (loadingRef.current) return;
        try {
          const tpl = await getTemplate(templateId);
          if (!tpl) return;
          const t = tpl as any;
          const remoteUpdated = t.metadata?.updatedAt;
          if (remoteUpdated && remoteUpdated !== lastRemoteUpdateRef.current) {
            if (lastRemoteUpdateRef.current !== null) {
              const remoteCanvasObjects = Array.isArray(t.canvasObjects)
                ? t.canvasObjects.map((object: any, index: number) => normalizeCanvasObject(object, index))
                : [];
              if (JSON.stringify(canvasObjectsRef.current) !== JSON.stringify(remoteCanvasObjects)) {
                canvasObjectsRef.current = remoteCanvasObjects;
                setCanvasObjects(remoteCanvasObjects);
                store.replaceCanvasObjects(remoteCanvasObjects);
              }
              // Safety: never replace non-empty local frames with empty remote frames
              if (t.frames && Array.isArray(t.frames) && t.frames.length > 0) {
                // Only update if frame data actually differs (avoid unnecessary re-renders)
                const localJson = JSON.stringify(framesRef.current);
                const remoteJson = JSON.stringify(t.frames);
                if (localJson !== remoteJson) {
                  store.replaceAll(t.frames as FrameData[]);
                  for (const rf of t.frames as FrameData[]) autoUngroupIncomingFrame(rf.id);
                }
              } else if (Array.isArray(t.frames) && t.frames.length === 0 && framesRef.current.length > 0) {
                // REQ-022: a saved zero-frame file is legitimate (the last frame
                // was deleted in another session or via MCP). We only poll when
                // not dirty, so accept the remote state instead of resurrecting
                // the deleted frames.
                store.replaceAll([]);
                setSelectedFrameId(null);
                setSelectedFrameIds(new Set());
              } else if (t.html !== undefined || t.css !== undefined) {
                const _pf = store.frames as FrameData[];
                store.replaceAll(_pf.map(f =>
                  f.id === selectedFrameId
                    ? { ...f, html: t.html || f.html, css: t.css || f.css }
                    : f
                ));
                if (selectedFrameId) autoUngroupIncomingFrame(selectedFrameId);
              }
            }
            lastRemoteUpdateRef.current = remoteUpdated;
          }
        } catch { /* silent */ }
      }, 5000);
    }
    const pChannel = subscribePresence(templateId, (agents) => setActiveAgents(agents));
    if (pChannel) presenceChannelRef.current = pChannel;
    return () => {
      if (realtimeChannelRef.current) { realtimeChannelRef.current.unsubscribe(); realtimeChannelRef.current = null; }
      if (presenceChannelRef.current) { presenceChannelRef.current.unsubscribe(); presenceChannelRef.current = null; }
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [templateId, selectedFrameId]);

  // ── Sequential-write chain (G9*): frame writes inside one burst must
  // compose. The contextual panel commits a rich-text html write and a css
  // write back to back, drags fire css writes faster than React re-renders,
  // and every mutator used to map over the same render-time `frames` — the
  // last write erased its sibling (text fill/posición revertía al guardar;
  // mismo clobber que el panel fixeó con cssChainRef). The chain holds the
  // accumulated array until React delivers the new one. ──
  const framesChainRef = useRef<FrameData[] | null>(null);
  useEffect(() => { framesChainRef.current = null; }, [frames]);
  const commitFrames = useCallback((next: FrameData[], label: string) => {
    framesChainRef.current = next;
    store.replaceAllWithUndo(next, label);
    autoSave(next);
  }, [autoSave]);

  // ── Code panel handlers (edit active frame) ──
  const handleHtmlChange = useCallback((newHtml: string) => {
    if (!selectedFrameId) return;
    const updated = (framesChainRef.current ?? frames).map(f =>
      f.id === selectedFrameId ? { ...f, html: newHtml } : f
    );
    // Coalesce: only push undo if >300ms since last push (avoids one-undo-per-keystroke)
    const now = Date.now();
    if (now - lastPushTimeRef.current > 300) {
            lastPushTimeRef.current = now;
    }
    commitFrames(updated, "code edit");
  }, [selectedFrameId, frames, commitFrames]);

  const handleCssChange = useCallback((newCss: string) => {
    if (!selectedFrameId) return;
    const updated = (framesChainRef.current ?? frames).map(f =>
      f.id === selectedFrameId ? { ...f, css: newCss } : f
    );
    const now = Date.now();
    if (now - lastPushTimeRef.current > 300) {
            lastPushTimeRef.current = now;
    }
    commitFrames(updated, "code edit");
  }, [selectedFrameId, frames, commitFrames]);

  // ── Svg paint-server fills (F2): gradients/photos become <defs> on the
  // shape's own <svg> — a css background can't tint a <path>. ──
  const handleSvgFillMedia = useCallback((frameId: string, layerId: string, media: SvgFillMedia) => {
    const base = framesChainRef.current ?? frames;
    const target = base.find(f => f.id === frameId);
    if (!target) return;
    const nextHtml = applyLayerSvgFill(target.html, layerId, media);
    if (!nextHtml) return;
    commitFrames(base.map(f => f.id === frameId ? { ...f, html: nextHtml } : f), "svg fill");
  }, [frames, commitFrames]);

  // ── Frame CSS (+ optional HTML) change from DesignFrame (drag/resize) ──
  const handleFrameCssChange = useCallback((frameId: string, newCss: string, newHtml?: string) => {
    const updated = (framesChainRef.current ?? frames).map(f =>
      f.id === frameId ? { ...f, css: newCss, ...(newHtml ? { html: newHtml } : {}) } : f
    );
    commitFrames(updated, "edit");
  }, [frames, commitFrames]);

  const handleFrameHtmlChange = useCallback((frameId: string, newHtml: string) => {
    const updated = (framesChainRef.current ?? frames).map(f =>
      f.id === frameId ? { ...f, html: newHtml } : f
    );
    commitFrames(updated, "edit");
  }, [frames, commitFrames]);

  // ── Figma-style frame selection handlers ──
  const handleSelectFrame = useCallback((id: string | null) => {
    setSelectedFrameId(id);
    setSelectedFrameIds(id ? new Set([id]) : new Set());
    setContentFrameId(null);
    setSelectedElement(null);
    setLayerSelectionRequest(null);
    setMultiSelectLayerIds([]);
    setSelectedGuideId(null);
    setCrossFrameTargets([]);
    frameDeleteArmRef.current = 0;
    // BUG-21: seleccionar elemento u orphan reabría el panel derecho, pero
    // seleccionar frame no — con el panel cerrado el click en un frame
    // parecía no hacer nada.
    if (id) setShowRightPanel(true);
  }, []);

  const handleActivateFrame = useCallback((frameId: string) => {
    setSelectedFrameId(frameId);
  }, []);

  const handleFrameShiftClick = useCallback((frameId: string) => {
    setSelectedFrameIds(prev => {
      const next = new Set(prev);
      if (next.has(frameId)) next.delete(frameId);
      else next.add(frameId);
      if (next.size === 1) setSelectedFrameId(Array.from(next)[0]);
      else if (next.size === 0) setSelectedFrameId(null);
      return next;
    });
    setContentFrameId(null);
    setSelectedElement(null);
    setMultiSelectLayerIds([]);
  }, []);

  const handleMarqueeSelect = useCallback((ids: Set<string>) => {
    setSelectedFrameIds(ids);
    if (ids.size > 0) setSelectedFrameId(Array.from(ids)[0]);
    else setSelectedFrameId(null);
    setContentFrameId(null);
    setSelectedElement(null);
    setMultiSelectLayerIds([]);
  }, []);

  const handleMarqueeSelectOrphans = useCallback((ids: Set<string>) => {
    setSelectedOrphanIds(ids);
    if (ids.size > 0) setSelectedFrameId(null);
  }, []);

  const handleEnterContentMode = useCallback((frameId: string) => {
    setContentFrameId(frameId);
    setSelectedFrameId(frameId);
    setSelectedFrameIds(new Set([frameId]));
    setSelectedOrphanIds(new Set());
  }, []);

  // ── Orphan (canvas-level object) handlers ──
  const handleSelectOrphan = useCallback((id: string | null) => {
    setSelectedOrphanIds(id ? new Set([id]) : new Set());
    setContentFrameId(null);
    setSelectedElement(null);
    if (id) {
      setSelectedFrameId(null);
      setShowRightPanel(true);
      setRightPanelTab("contextual");
      if (contextualSubTab !== "properties" && contextualSubTab !== "code") setContextualSubTab("properties");
    }
    setMultiSelectLayerIds([]);
  }, [contextualSubTab]);

  const handleOrphanShiftClick = useCallback((id: string) => {
    setSelectedOrphanIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setContentFrameId(null);
    setSelectedElement(null);
    setMultiSelectLayerIds([]);
  }, []);

  const handleOrphanMove = useCallback((id: string, x: number, y: number) => {
    commitCanvasObjects(canvasObjectsRef.current.map(object =>
      object.id === id ? { ...object, x: Math.round(x), y: Math.round(y) } : object
    ));
  }, [commitCanvasObjects]);

  const handleDeleteOrphan = useCallback((id: string) => {
    commitCanvasObjects(canvasObjectsRef.current.filter(object => object.id !== id));
    setSelectedOrphanIds(prev => { const next = new Set(prev); next.delete(id); return next; });
  }, [commitCanvasObjects]);

  /** Create a canvas-level orphan object from a drawing tool on empty canvas. */
  const handleCreateOrphanFromTool = useCallback((type: string, x: number, y: number, rawW: number, rawH: number) => {
    // Shapes keep their default 150×150 when drawn by a click (0,0); the text
    // branches below read rawW/rawH to tell a click from a drag.
    const w = rawW || 150;
    const h = rawH || 150;
    const orphanId = createOrphanId();
    let html = "";
    let css = "";
    const nameMap: Record<string, string> = { rect: "Rectangle", circle: "Circle", triangle: "Triangle", star: "Star", polygon: "Polygon", text: "Text", pen: "Bezier", pencil: "Pencil Stroke" };
    const oname = nameMap[type] || type;
    if (type === "rect") {
      html = `<div data-layer-id="${orphanId}" data-layer-name="${oname}" data-layer-kind="shape"></div>`;
      css = `[data-layer-id="${orphanId}"] {\n  position: absolute;\n  left: 0;\n  top: 0;\n  width: ${w}px;\n  height: ${h}px;\n  background-color: #3B82F6;\n  border-radius: 0;\n}`;
    } else if (type === "circle") {
      html = `<div data-layer-id="${orphanId}" data-layer-name="${oname}" data-layer-kind="shape"></div>`;
      css = `[data-layer-id="${orphanId}"] {\n  position: absolute;\n  left: 0;\n  top: 0;\n  width: ${w}px;\n  height: ${h}px;\n  background-color: #EF4444;\n  border-radius: 50%;\n}`;
    } else if (type === "triangle") {
      html = `<svg data-layer-id="${orphanId}" data-layer-name="${oname}" data-layer-kind="svg" viewBox="0 0 ${w} ${h}" style="position:absolute;left:0;top:0;width:${w}px;height:${h}px;overflow:visible;"><path d="M${w / 2} 0 L0 ${h} L${w} ${h} Z" fill="#10B981" stroke="#059669" stroke-width="0"/></svg>`;
      css = `[data-layer-id="${orphanId}"] {\n  position: absolute;\n  left: 0;\n  top: 0;\n  width: ${w}px;\n  height: ${h}px;\n  overflow: visible;\n}`;
    } else if (type === "star") {
      const s = Math.max(w, h);
      const d = generateStarPath(s, 5, 0.4);
      html = `<svg data-layer-id="${orphanId}" data-layer-name="${oname}" data-layer-kind="svg" data-shape="star" viewBox="0 0 ${s} ${s}" style="position:absolute;left:0;top:0;width:${s}px;height:${s}px;overflow:visible;"><path d="${d}" fill="#F59E0B" stroke="#D97706" stroke-width="0"/></svg>`;
      css = `[data-layer-id="${orphanId}"] {\n  position: absolute;\n  left: 0;\n  top: 0;\n  width: ${s}px;\n  height: ${s}px;\n  overflow: visible;\n}`;
    } else if (type === "polygon") {
      const n = clampShapeCount(6);
      const s = Math.max(w, h);
      const d = generatePolygonPath(s, n);
      html = `<svg data-layer-id="${orphanId}" data-layer-name="${oname}" data-layer-kind="svg" data-shape="polygon" viewBox="0 0 ${s} ${s}" style="position:absolute;left:0;top:0;width:${s}px;height:${s}px;overflow:visible;"><path d="${d}" fill="#8B5CF6" stroke="#7C3AED" stroke-width="0"/></svg>`;
      css = `[data-layer-id="${orphanId}"] {\n  position: absolute;\n  left: 0;\n  top: 0;\n  width: ${s}px;\n  height: ${s}px;\n  overflow: visible;\n}`;
    } else if (type === "pen" || type === "pencil") {
      html = `<svg data-layer-id="${orphanId}" data-layer-name="${oname}" data-layer-kind="bezier" viewBox="0 0 ${w} ${h}" style="position:absolute;left:0;top:0;width:${w}px;height:${h}px;overflow:visible;"><path d="M 0 ${h} C ${w * 0.25} ${h * 0.25}, ${w * 0.75} ${h * 0.75}, ${w} 0" fill="none" stroke="#111827" stroke-width="2" stroke-linecap="round"/></svg>`;
      css = `[data-layer-id="${orphanId}"] {
  position: absolute;
  left: 0;
  top: 0;
  width: ${w}px;
  height: ${h}px;
  overflow: visible;
}`;
    } else if (rawW >= 40 && rawH >= 20) {
      // Drag-drawn text box: fixed size, same shape the in-frame tool creates.
      html = `<div data-layer-id="${orphanId}" data-layer-name="${oname}" data-layer-kind="text" data-text-resizing="fixed" style="font-size:24px;color:#333;position:absolute;left:0;top:0;width:${rawW}px;height:${rawH}px;overflow:hidden;">Type something</div>`;
      css = `[data-layer-id="${orphanId}"] {\n  font-size: 24px;\n  color: #333;\n  position: absolute;\n  left: 0;\n  top: 0;\n  width: ${rawW}px;\n  height: ${rawH}px;\n  overflow: hidden;\n}`;
    } else {
      html = `<div data-layer-id="${orphanId}" data-layer-name="${oname}" data-layer-kind="text" style="font-size:24px;color:#333;position:absolute;left:0;top:0;">Type something</div>`;
      css = `[data-layer-id="${orphanId}"] {\n  font-size: 24px;\n  color: #333;\n  position: absolute;\n  left: 0;\n  top: 0;\n}`;
    }
    const newOrphan: HtmlCanvasObject = {
      id: orphanId,
      name: oname,
      kind: type === "text" ? "text" : type === "pen" || type === "pencil" ? "bezier" : "shape",
      frameId: null,
      html, css,
      x: Math.round(x), y: Math.round(y),
      width: w, height: h,
      zIndex: canvasObjectsRef.current.length + frames.length,
    };
    commitCanvasObjects([...canvasObjectsRef.current, newOrphan]);
    setSelectedOrphanIds(new Set([orphanId]));
    setActiveTool("select");
    // Text starts in edit mode so the user can type immediately — and the
    // contextual panel must already be on it: font picker visible, no extra click.
    if (type === "text") {
      setAutoEditOrphanId(orphanId);
      setContentFrameId(null);
      setSelectedElement(null);
      setSelectedFrameId(null);
      setMultiSelectLayerIds([]);
      setShowRightPanel(true);
      setRightPanelTab("contextual");
      setContextualSubTab("properties");
    }
  }, [frames.length, commitCanvasObjects]);

  /** Text-tool drag that straddled/escaped its frame: the box becomes a
   *  canvas-level orphan at absolute coordinates (straddle rule). */
  const handleCreateOrphanText = useCallback((x: number, y: number, w: number, h: number) => {
    handleCreateOrphanFromTool("text", x, y, w, h);
  }, [handleCreateOrphanFromTool]);

  const [autoEditOrphanId, setAutoEditOrphanId] = useState<string | null>(null);

  /** Commit inline-edited orphan HTML (text typed on the canvas). */
  const handleOrphanHtmlChange = useCallback((id: string, html: string) => {
    const updated = canvasObjectsRef.current.map(o => o.id === id ? { ...o, html } : o);
    commitCanvasObjects(updated);
  }, [commitCanvasObjects]);

  /** Orphan CSS change (from inline editing or context panel) */
  const handleOrphanCssChange = useCallback((orphanId: string, newCss: string, newHtml?: string) => {
    const selector = `[data-layer-id="${orphanId}"]`;
    const widthValue = getCssPropertyValue(newCss, selector, "width").trim();
    const heightValue = getCssPropertyValue(newCss, selector, "height").trim();
    const cssWidth = /^\d+(?:\.\d+)?px(?:\s*!important)?$/i.test(widthValue) ? parseFloat(widthValue) : NaN;
    const cssHeight = /^\d+(?:\.\d+)?px(?:\s*!important)?$/i.test(heightValue) ? parseFloat(heightValue) : NaN;
    commitCanvasObjects(canvasObjectsRef.current.map(object => object.id === orphanId ? {
      ...object,
      css: newCss,
      ...(Number.isFinite(cssWidth) && cssWidth > 0 ? { width: Math.round(cssWidth) } : {}),
      ...(Number.isFinite(cssHeight) && cssHeight > 0 ? { height: Math.round(cssHeight) } : {}),
      ...(newHtml !== undefined ? { html: newHtml } : {}),
    } : object));
  }, [commitCanvasObjects]);

  /** Svg paint-server fill (gradient/photo defs) for orphan shapes. */
  const handleOrphanSvgFillMedia = useCallback((orphanId: string, _layerId: string, media: SvgFillMedia) => {
    const orphan = canvasObjectsRef.current.find(o => o.id === orphanId);
    if (!orphan) return;
    const nextHtml = applyLayerSvgFill(orphan.html, orphanId, media);
    if (!nextHtml) return;
    commitCanvasObjects(canvasObjectsRef.current.map(o => o.id === orphanId ? { ...o, html: nextHtml } : o));
  }, [commitCanvasObjects]);

  /** Resize a root object with the same CSS-backed dimensions as an in-frame layer. */
  const handleOrphanResize = useCallback((orphanId: string, width: number, height: number, x: number, y: number) => {
    const selector = `[data-layer-id="${orphanId}"]`;
    commitCanvasObjects(canvasObjectsRef.current.map(object => {
      if (object.id !== orphanId) return object;
      let css = updateCssProperty(object.css, selector, "width", `${width}px !important`);
      css = updateCssProperty(css, selector, "height", `${height}px !important`);
      return { ...object, x, y, width, height, css };
    }));
  }, [commitCanvasObjects]);

  const handleOrphanRotate = useCallback((orphanId: string, degrees: number) => {
    const selector = `[data-layer-id="${orphanId}"]`;
    commitCanvasObjects(canvasObjectsRef.current.map(object => {
      if (object.id !== orphanId) return object;
      const current = getCssPropertyValue(object.css, selector, "transform");
      return { ...object, css: updateCssProperty(object.css, selector, "transform", setTransformFunction(current, "rotate", `${degrees}deg`)) };
    }), framesRef.current, "rotate object");
  }, [commitCanvasObjects]);

  const handleOrphanRadiusChange = useCallback((orphanId: string, radius: number) => {
    const selector = `[data-layer-id="${orphanId}"]`;
    commitCanvasObjects(canvasObjectsRef.current.map(object => object.id === orphanId
      ? { ...object, css: updateCssProperty(object.css, selector, "border-radius", `${radius}px`) }
      : object), framesRef.current, "round object");
  }, [commitCanvasObjects]);

  /** Reorder orphan z-index in layers panel */
  const handleOrphanZReorder = useCallback((orphanId: string, newZ: number) => {
    const next = canvasObjectsRef.current
      .map(object => object.id === orphanId ? { ...object, zIndex: newZ } : object)
      .sort((a, b) => a.zIndex - b.zIndex);
    commitCanvasObjects(next);
  }, [commitCanvasObjects]);

  /** Update orphan tag (root element name) */
  const handleOrphanTagChange = useCallback((orphanId: string, newTag: string) => {
    const orphan = canvasObjectsRef.current.find(o => o.id === orphanId);
    if (!orphan) return;
    const newHtml = changeLayerTag(orphan.html, orphanId, newTag);
    if (newHtml === null) return;
    const next = canvasObjectsRef.current.map(o =>
      o.id === orphanId ? { ...o, html: newHtml, name: newTag } : o
    );
    commitCanvasObjects(next);
  }, [commitCanvasObjects]);

  /** Update orphan width/height */
  const handleOrphanDimensionChange = useCallback((orphanId: string, field: "width" | "height", value: number) => {
    if (value < 1) return;
    const next = canvasObjectsRef.current.map(object => {
      if (object.id !== orphanId) return object;
      const rounded = Math.round(value);
      return {
        ...object,
        [field]: rounded,
        css: updateCssProperty(object.css, `[data-layer-id="${orphanId}"]`, field, `${rounded}px !important`),
      };
    });
    commitCanvasObjects(next);
  }, [commitCanvasObjects]);

  /** Update orphan x/y position */
  const handleOrphanPositionChange = useCallback((orphanId: string, field: "x" | "y", value: number) => {
    const next = canvasObjectsRef.current.map(o =>
      o.id === orphanId ? { ...o, [field]: Math.round(value) } : o
    );
    commitCanvasObjects(next);
  }, [commitCanvasObjects]);

  /** Set orphan z-index to an absolute value */
  const handleOrphanZIndexSet = useCallback((orphanId: string, zIndex: number) => {
    const next = canvasObjectsRef.current.map(o =>
      o.id === orphanId ? { ...o, zIndex } : o
    );
    commitCanvasObjects(next);
  }, [commitCanvasObjects]);

  /** Move a layer from a frame to canvas (orphan) preserving visual position */
  const handleMoveLayerToCanvas = useCallback((frameId: string, layerId: string) => {
    const frame = frames.find(f => f.id === frameId);
    if (!frame) return;
    const extracted = extractLayerFromHtml(frame.html, layerId);
    if (!extracted) return;
    let transferredCss = cloneLayerTreeCss(frame.css, extracted.layerHtml, extracted.layerIds, new Map(extracted.layerIds.map(id => [id, id])), 0);
    const sourceCss = removeLayersCss(frame.css, extracted.layerIds);
    const selection = selectedElement?.layerId === layerId && selectedElement.frameId === frameId ? selectedElement : null;
    const translate = parseTranslate(selection?.computedStyles.translate || "");
    const logicalX = parseFloat(selection?.computedStyles.left || "") || 0;
    const logicalY = parseFloat(selection?.computedStyles.top || "") || 0;
    const bounds = selection?.visualBounds;
    const visualX = bounds?.x ?? logicalX + translate.x;
    const visualY = bounds?.y ?? logicalY + translate.y;
    const contentWidth = parseFloat(selection?.computedStyles.width || "") || bounds?.width || frame.width;
    const contentHeight = parseFloat(selection?.computedStyles.height || "") || bounds?.height || frame.height;
    const selector = `[data-layer-id="${layerId}"]`;
    transferredCss = updateCssProperty(transferredCss, selector, "position", "absolute");
    transferredCss = updateCssProperty(transferredCss, selector, "left", `${-(visualX - logicalX - translate.x)}px !important`);
    transferredCss = updateCssProperty(transferredCss, selector, "top", `${-(visualY - logicalY - translate.y)}px !important`);
    transferredCss = updateCssProperty(transferredCss, selector, "translate", "none !important");
    transferredCss = updateCssProperty(transferredCss, selector, "width", `${contentWidth}px !important`);
    transferredCss = updateCssProperty(transferredCss, selector, "height", `${contentHeight}px !important`);
    const newOrphan: HtmlCanvasObject = {
      id: layerId,
      name: /data-layer-name=["']([^"']+)["']/i.exec(extracted.layerHtml)?.[1] || "Object",
      kind: /data-layer-kind=["']([^"']+)["']/i.exec(extracted.layerHtml)?.[1] || "shape",
      frameId: null,
      html: extracted.layerHtml,
      css: transferredCss,
      x: frame.x + visualX, y: frame.y + visualY,
      width: bounds?.width || contentWidth, height: bounds?.height || contentHeight,
      zIndex: canvasObjectsRef.current.length + frames.length,
    };
    const updated = frames.map(f => f.id === frameId ? { ...f, html: extracted.html, css: sourceCss } : f);
    commitCanvasObjects([...canvasObjectsRef.current, newOrphan], updated, "move to canvas");
    addToast("Layer moved to canvas.", "success");
  }, [frames, selectedElement, commitCanvasObjects, addToast]);

  /** Move an orphan into a target frame */
  const handleMoveOrphanToFrame = useCallback((orphanId: string, targetFrameId: string) => {
    const orphan = canvasObjects.find(o => o.id === orphanId);
    const targetFrame = frames.find(f => f.id === targetFrameId);
    if (!orphan || !targetFrame) return;
    const inserted = insertLayerIntoHtml(targetFrame.html, orphan.html, null, "inside");
    if (!inserted) { addToast("Could not insert object into frame.", "error"); return; }
    const selector = `[data-layer-id="${orphan.id}"]`;
    const sourceLeft = parseFloat(getCssPropertyValue(orphan.css, selector, "left")) || 0;
    const sourceTop = parseFloat(getCssPropertyValue(orphan.css, selector, "top")) || 0;
    let movedCss = updateCssProperty(orphan.css, selector, "position", "absolute");
    movedCss = updateCssProperty(movedCss, selector, "left", `${orphan.x - targetFrame.x + sourceLeft}px !important`);
    movedCss = updateCssProperty(movedCss, selector, "top", `${orphan.y - targetFrame.y + sourceTop}px !important`);
    movedCss = updateCssProperty(movedCss, selector, "width", `${orphan.width}px !important`);
    movedCss = updateCssProperty(movedCss, selector, "height", `${orphan.height}px !important`);
    const combinedCss = mergeCssRules(targetFrame.css, movedCss);
    const updated = frames.map(f => f.id === targetFrameId ? { ...f, html: inserted.html, css: combinedCss } : f);
    commitCanvasObjects(canvasObjectsRef.current.filter(object => object.id !== orphanId), updated, "move to frame");
    setSelectedOrphanIds(prev => { const next = new Set(prev); next.delete(orphanId); return next; });
    addToast("Object moved into frame.", "success");
  }, [canvasObjects, frames, commitCanvasObjects, addToast]);

  /** Drop an orphan onto a frame (from layers panel or canvas drag) */
  const handleOrphanDropToFrame = useCallback((orphanId: string, targetFrameId: string) => {
    handleMoveOrphanToFrame(orphanId, targetFrameId);
    setShowRightPanel(false);
  }, [handleMoveOrphanToFrame]);

  const handleRenameFrame = useCallback((frameId: string, newName: string) => {
        const updated = frames.map(f => f.id === frameId ? { ...f, name: newName } : f);
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
  }, [frames, autoSave]);

  const handleMultiFrameMove = useCallback((moves: { id: string; x: number; y: number }[]) => {

    const moveMap = new Map(moves.map(m => [m.id, { x: m.x, y: m.y }]));
    const updated = frames.map(f =>
      moveMap.has(f.id) ? { ...f, x: moveMap.get(f.id)!.x, y: moveMap.get(f.id)!.y } : f
    );
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
  }, [frames, autoSave]);

  // ── Frame operations ──
  const handleFrameMove = useCallback((id: string, x: number, y: number) => {
    const updated = frames.map(f =>
      f.id === id ? { ...f, x: Math.round(x), y: Math.round(y) } : f
    );
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
  }, [frames, autoSave]);

  const handleFrameResize = useCallback((id: string, width: number, height: number, x: number, y: number) => {
    const updated = frames.map(f =>
      f.id === id
        ? (() => {
            const w = Math.round(width);
            const h = Math.round(height);
            // A resized frame must stop clipping at its birth size: the F-tool
            // seeds `body { width/height }` into frame.css and mapBodySelectors
            // re-emits it after the live clip rule, so cascade keeps the stale
            // size unless the persisted rule is rewritten too.
            return { ...f, x: Math.round(x), y: Math.round(y), width: w, height: h, css: resizeFrameBodyCss(f.css, w, h) };
          })()
        : f
    );
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
  }, [frames, autoSave]);

  const handleFrameBackgroundChange = useCallback((bg: string) => {
    if (!selectedFrameId) return;
    const updated = frames.map(f =>
      f.id === selectedFrameId ? { ...f, background: bg } : f
    );
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
  }, [selectedFrameId, frames, autoSave]);

  // ── F0 animation: frame.animation persists like every other frame field —
  // whole-document replace + autosave. It rides templates.data JSONB, so no
  // Supabase DDL migration is needed.
  const handleFrameAnimationChange = useCallback((frameId: string, animation: AnimationSchema | null) => {
    const updated = frames.map(f =>
      f.id === frameId ? { ...f, animation: animation ?? undefined } : f
    );
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
  }, [frames, autoSave]);

  // ── Modo color del archivo: convierte los colores de TODOS los frames al
  // gamut de imprenta (quedan guardados como RGB hex — el diseño nunca
  // almacena CMYK). Aproximación sin ICC; la prueba exacta es el soft-proof
  // del export. El estado previo queda en snapshot de sesión para volver.
  const [fileColorMode, setFileColorModeState] = useState<"rgb" | "cmyk">(() => {
    try { return localStorage.getItem(`musa:fileColorMode:${templateWorkspaceId}`) === "cmyk" ? "cmyk" : "rgb"; } catch { return "rgb"; }
  });
  // Persistente por workspace (paridad con Document Color Mode de
  // Illustrator): el modo sobrevive recargas; el snapshot RGB original sigue
  // siendo de sesión.
  const fileColorModeKey = `musa:fileColorMode:${templateWorkspaceId}`;
  const setFileColorMode = useCallback((mode: "rgb" | "cmyk") => {
    setFileColorModeState(mode);
    try { localStorage.setItem(fileColorModeKey, mode); } catch { /* storage no disponible */ }
  }, [fileColorModeKey]);
  const rgbColorSnapshotRef = useRef<Map<string, FrameData>>(new Map());
  const handleConvertFileColors = useCallback((toCmyk: boolean) => {
    const base = framesChainRef.current ?? frames;
    if (toCmyk) {
      const snap = new Map<string, FrameData>();
      for (const f of base) snap.set(f.id, f);
      rgbColorSnapshotRef.current = snap;
      commitFrames(base.map(f => ({
        ...f,
        css: mapCssColors(f.css, clampToCmykGamut),
        html: mapCssColors(f.html, clampToCmykGamut),
        background: mapCssColors(f.background || "", clampToCmykGamut),
      })), "convertir a CMYK");
      setFileColorMode("cmyk");
    } else {
      const snap = rgbColorSnapshotRef.current;
      if (snap.size === 0) return;
      rgbColorSnapshotRef.current = new Map();
      commitFrames(base.map(f => snap.get(f.id) || f), "volver a RGB");
      setFileColorMode("rgb");
    }
  }, [frames, commitFrames]);

  // ── Modo Video (REQ-VID3): reel membership + frame order = take order.
  // Both ride the frame objects/templates.data JSONB — no migration needed.
  const [videoModeOpen, setVideoModeOpen] = useState(false);
  const [presentationOpen, setPresentationOpen] = useState(false);
    // videoTimeline (v2): el doc vive en un store con journal persistente
    // (videoDocStore) — undo/redo por operación semántica que sobrevive la
    // recarga (REQ-035 RF-02/RF-08). Los BINARIOS siguen en Supabase Storage;
    // aquí solo URLs públicas (nunca data-URLs en JSONB).
    const videoDocStoreRef = useRef<VideoDocStore | null>(null);
    if (!videoDocStoreRef.current) videoDocStoreRef.current = new VideoDocStore(emptyVideoTimelineDoc());
    const videoDocStore = videoDocStoreRef.current;
    const videoTimelineDocState = useSyncExternalStore(videoDocStore.subscribe, videoDocStore.getSnapshot);
    const videoTimelineRef = useRef<VideoTimelineDoc>(videoTimelineDocState);
    const handleVideoTimelineChange = useCallback((doc: VideoTimelineDoc, meta?: VideoDocApplyMeta) => {
      // Ref síncrona: el subscriber de abajo autosavea ANTES del re-render.
      videoTimelineRef.current = doc;
      videoDocStore.apply(doc, meta);
    }, [videoDocStore]);
    // Todo cambio del journal (apply/undo/redo) autosavea; la ref se
    // actualiza aquí también para undo/redo (que no pasan por el handler).
    useEffect(() => {
      return videoDocStore.subscribe(() => {
        videoTimelineRef.current = videoDocStore.getSnapshot();
        autoSave(framesRef.current);
      });
    }, [videoDocStore, autoSave]);
    // V3.1: los shortcuts globales viven en listeners window CAPTURE — corren
    // ANTES que los handlers React del modo video, así que el swallow del
    // overlay no los alcanza. Gate por ref (sin re-suscribir el effect).
    const videoModeOpenRef = useRef(videoModeOpen);
    videoModeOpenRef.current = videoModeOpen;
  // ── Modo Foto (REQ-PHOTO-PLATFORM-001): mismo patrón embebido que Modo
  // Video. El ref gatea los shortcuts globales: mientras el overlay está
  // abierto, es el dueño del teclado (zoom/flechas/escape son suyos).
  const [photoModeOpen, setPhotoModeOpen] = useState(false);
  const [photoModeTarget, setPhotoModeTarget] = useState<PhotoTarget | null>(null);
  // Raster de frames para el Modo Foto: picker de origen, raster en curso y
  // cache {frameId:hash → assetUrl} para no re-rasterizar al reentrar.
  const [photoFramePickerOpen, setPhotoFramePickerOpen] = useState(false);
  const [frameRasterBusyId, setFrameRasterBusyId] = useState<string | null>(null);
  const frameRasterCacheRef = useRef<Map<string, string>>(new Map());
  const photoModeOpenRef = useRef(photoModeOpen);
  photoModeOpenRef.current = photoModeOpen;

  // ── Refresh-in-place de los modos (deep-link): ?view=video|foto en la URL
  // reabre el modo en el que estaba el usuario. Foto restaura SU capa exacta
  // (frame+layer en la URL) una vez los frames cargan; sin capa anclada abre
  // el picker, que es el mismo flujo seguro del menú Editor → Fotos. ──
  const pendingPhotoRestoreRef = useRef<{ frameId: string | null; layerId: string } | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const view = params.get("view");
    if (view === "video") setVideoModeOpen(true);
    if (view === "foto") {
      const layerId = params.get("layer") || "";
      if (layerId) pendingPhotoRestoreRef.current = { frameId: params.get("frame"), layerId };
      else setPhotoFramePickerOpen(true);
    }
  }, []);

  // presentation_open devuelve ?present=1&presentationFrame=<id>. Espera a
  // que el template termine de cargar y consume el enlace una sola vez: el
  // visor queda libre de efectos del canvas y abre exactamente el frame pedido.
  const pendingPresentationFrameRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (pendingPresentationFrameRef.current !== undefined || loading) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("present") !== "1") {
      pendingPresentationFrameRef.current = null;
      return;
    }
    const requestedFrameId = params.get("presentationFrame");
    const requestedFrame = requestedFrameId ? frames.find(frame => frame.id === requestedFrameId) : null;
    if (requestedFrame) setSelectedFrameId(requestedFrame.id);
    if (frames.length > 0) setPresentationOpen(true);
    pendingPresentationFrameRef.current = requestedFrameId || null;
  }, [loading, frames]);

  // Resolución diferida del target de foto: espera a que los frames estén en
  // memoria y busca la capa anclada (en su frame propietario o como objeto
  // huérfano del lienzo — mismos dos caminos que handleOpenPhotoMode).
  useEffect(() => {
    const pending = pendingPhotoRestoreRef.current;
    if (!pending || loading) return;
    pendingPhotoRestoreRef.current = null;
    const { frameId, layerId } = pending;
    if (frameId) {
      const frame = frames.find(f => f.id === frameId);
      const img = frame ? parseFrameImages(frame.id, frame.html || "").find(i => i.layerId === layerId) : null;
      if (img) { setPhotoModeTarget(img); setPhotoModeOpen(true); }
      return;
    }
    for (const o of canvasObjects) {
      if (o.kind !== "image") continue;
      const img = parseFrameImages(o.id, o.html || "").find(i => i.layerId === layerId);
      if (img) { setPhotoModeTarget({ ...img, frameId: null, name: o.name || img.name }); setPhotoModeOpen(true); return; }
    }
  }, [loading, frames, canvasObjects]);

  // La URL refleja el modo activo mientras dura: refresh (o compartir el
  // link) reabre video/foto; al cerrar el modo los params se van. El resto
  // de la query (?template=…) se conserva intacta.
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const view = videoModeOpen ? "video" : photoModeOpen ? "foto" : null;
      if (view) {
        url.searchParams.set("view", view);
        if (view === "foto" && photoModeTarget) {
          if (photoModeTarget.frameId) url.searchParams.set("frame", photoModeTarget.frameId);
          url.searchParams.set("layer", photoModeTarget.layerId);
        }
      } else {
        url.searchParams.delete("view");
        url.searchParams.delete("frame");
        url.searchParams.delete("layer");
      }
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    } catch { /* history no disponible en embeds */ }
  }, [videoModeOpen, photoModeOpen, photoModeTarget]);

  const closePresentation = useCallback(() => {
    setPresentationOpen(false);
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("present");
      url.searchParams.delete("presentationFrame");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    } catch { /* history no disponible en embeds */ }
  }, []);
  const handleFrameReelChange = useCallback((frameId: string, reelExcluded: boolean) => {
    const updated = frames.map(f => (f.id === frameId ? { ...f, reelExcluded } : f));
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
  }, [frames, autoSave]);
  // V3.2: per-take look filter — same persistence path as reelExcluded.
  const handleFrameReelFilterChange = useCallback((frameId: string, filter: string) => {
    const updated = frames.map(f => (f.id === frameId ? { ...f, reelFilter: filter || undefined } : f));
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
  }, [frames, autoSave]);
  // V4.0: per-take framing on the project canvas (null = contain reset).
  const handleFrameReelLayoutChange = useCallback((frameId: string, layout: ReelTakeLayout | null) => {
    const updated = frames.map(f => (f.id === frameId ? { ...f, reelLayout: layout ?? undefined } : f));
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
  }, [frames, autoSave]);
  // V5.2: animated take FX (null = none) — same persistence path.
  const handleFrameReelFxChange = useCallback((frameId: string, fx: { id: string; intensity: number } | null) => {
    const updated = frames.map(f => (f.id === frameId ? { ...f, reelFx: fx ?? undefined } : f));
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
  }, [frames, autoSave]);
  // V5.3: static overlay FX stack (empty = none).
  const handleFrameReelOverlayFxChange = useCallback((frameId: string, ids: string[]) => {
    const updated = frames.map(f => (f.id === frameId ? { ...f, reelOverlayFx: ids.length ? ids : undefined } : f));
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
  }, [frames, autoSave]);
  // REQ044: animated particle overlay (null = none) — same persistence path.
  const handleFrameReelParticlesChange = useCallback((frameId: string, fx: { id: string; density: number } | null) => {
    const updated = frames.map(f => (f.id === frameId ? { ...f, reelParticles: fx ?? undefined } : f));
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
  }, [frames, autoSave]);
  // P1.6: per-frame layer stack overrides (video mode only; null clears).
  const handleFrameLayerZChange = useCallback((frameId: string, layerZ: Record<string, number> | null) => {
    const updated = frames.map(f => (f.id === frameId ? { ...f, layerZ: layerZ ?? undefined } : f));
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
  }, [frames, autoSave]);
  // V4.3: bake the current framing INTO the design html — the frame's canvas
  // becomes the project canvas (reelLayout cleared; no more letterbox).
  const handleBakeFrameToDesign = useCallback((frameId: string) => {
    const frame = frames.find(f => f.id === frameId);
    if (!frame) return;
    const project = resolveProject(videoTimelineDocState, frames);
    const p = placeTake(project, frame, frame.reelLayout);
    const wrapped = `<div style="position:relative;width:${project.width}px;height:${project.height}px;overflow:hidden;background:${project.bg}"><div style="position:absolute;left:${p.left.toFixed(1)}px;top:${p.top.toFixed(1)}px;width:${frame.width}px;height:${frame.height}px;transform:scale(${p.k});transform-origin:top left">${frame.html}</div></div>`;
    const updated = frames.map(f => (f.id === frameId
      ? { ...f, html: wrapped, width: project.width, height: project.height, reelLayout: undefined }
      : f));
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
    addToast(`Encuadre horneado: el diseño ahora es ${project.width}×${project.height}`, "success");
  }, [frames, videoTimelineDocState, store, autoSave, addToast]);
  // V4.3: "Adaptar con IA" — clipboard prompt for the editor's AI flow.
  const handleAdaptFrameWithAI = useCallback((frameId: string, w: number, h: number) => {
    const frame = frames.find(f => f.id === frameId);
    if (!frame) return;
    const prompt = [
      `Adapta el diseño "${frame.name}" (${frame.width}×${frame.height}) al formato ${w}×${h}.`,
      "Mantén la jerarquía visual y el contenido; reubica los elementos para llenar el nuevo lienzo sin recortes ni letterbox.",
      "Devuelve el HTML+CSS completo del frame en el nuevo tamaño.",
    ].join(" ");
    void navigator.clipboard.writeText(prompt).then(() => {
      addToast("Prompt de adaptación copiado — pégalo en tu flujo de IA y reemplaza el frame", "info");
    }).catch(() => {
      addToast("No se pudo copiar el prompt al portapapeles", "error");
    });
  }, [frames, addToast]);
  const handleFramesReorder = useCallback((orderedIds: string[]) => {
    const byId = new Map(frames.map(f => [f.id, f] as const));
    const reordered = orderedIds.map(id => byId.get(id)).filter((f): f is FrameData => !!f);
    if (reordered.length !== frames.length) return; // partial data — refuse rather than drop frames
    store.replaceAllWithUndo(reordered, "edit");
    autoSave(reordered);
  }, [frames, autoSave]);

  // ── F1 client-side video export: the browser is the render engine (0
  // invocations, 0 LLM tokens); the result downloads locally.
  const [exportingFrameId, setExportingFrameId] = useState<string | null>(null);
  const handleFrameVideoExport = useCallback(async (frame: FrameData) => {
    if (exportingFrameId) return;
    setExportingFrameId(frame.id);
    try {
      const result = await exportFrameVideo({ frame });
      const base = (frame.name || "frame").replace(/[^\w\-]+/g, "_").slice(0, 40) || "frame";
      downloadBlob(result.blob, `${base}_animation.${result.mimeType.includes("mp4") ? "mp4" : "webm"}`);
      addToast(`Video exportado: ${result.frameCount} frames (${result.method === "webcodecs" ? "WebCodecs" : "MediaRecorder"})`, "success");
    } catch (err) {
      console.error("Video export failed:", err);
      addToast(`Export de video falló: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setExportingFrameId(null);
    }
  }, [exportingFrameId, addToast]);

  const handleFrameDimensionChange = useCallback((field: "width" | "height", value: number) => {
    if (!selectedFrameId || !value || value < 10) return;
    const updated = frames.map(f =>
      f.id === selectedFrameId ? { ...f, [field]: Math.round(value) } : f
    );
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
  }, [selectedFrameId, frames, autoSave]);

  const handleFrameBackgroundImage = useCallback(async (file: File) => {
    if (!selectedFrameId) return;
    try {
      // Read file as base64
      const b64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(file);
      });
      // Upload to Supabase Storage via API
      const res = await apiFetch<{ url: string }>("/api/assets/upload-file", {
        method: "POST",
        body: JSON.stringify({
          name: file.name,
          data: b64,
          filename: file.name,
          mimeType: file.type,
          workspaceId: templateWorkspaceId || undefined,
        }),
      });
      // Set frame background to cover image
      const bgValue = `url(${res.url}) center/cover no-repeat`;
      const updated = frames.map(f =>
        f.id === selectedFrameId ? { ...f, background: bgValue } : f
      );
      store.replaceAllWithUndo(updated, "edit");
      autoSave(updated);
      addToast("Background image applied", "success");
    } catch (err: any) {
      console.error("[BG_IMAGE] Upload failed:", err);
      addToast("Failed to upload background image", "error");
    }
  }, [selectedFrameId, frames, autoSave, templateWorkspaceId, addToast]);

  const deleteFrames = useCallback((frameIds: Set<string>): boolean => {
    if (frameIds.size === 0) return false;
    const updated = frames.filter(frame => !frameIds.has(frame.id));
    // REQ-022: zero frames is a valid state — deleting the last frame is
    // allowed; the canvas then shows the add-frame empty state. The only
    // failure left is "nothing was actually deleted".
    if (updated.length === frames.length) return false;

    store.replaceAllWithUndo(updated, "edit");
    setSelectedFrameId(updated[0]?.id ?? null);
    setSelectedFrameIds(updated[0]?.id ? new Set([updated[0].id]) : new Set());
    setContentFrameId(null);
    setSelectedElement(null);
    setLayerSelectionRequest(null);
    autoSave(updated);
    return true;
  }, [frames, autoSave]);

  const deleteSelectedFrame = useCallback(() => {
    if (!selectedFrameId) return;
    deleteFrames(new Set([selectedFrameId]));
  }, [selectedFrameId, deleteFrames]);

  const duplicateFrame = useCallback(() => {
    const src = frames.find(f => f.id === selectedFrameId);
    if (!src) return;
    const clone = cloneFrame(src, src.x + src.width + FRAME_GAP, src.y, `Frame ${nextFrameNumber(frames)}`);
        const updated = [...frames, clone];
    store.replaceAllWithUndo(updated, "edit");
    setSelectedFrameId(clone.id);
    setSelectedFrameIds(new Set([clone.id]));
    setContentFrameId(null);
    setSelectedElement(null);
    autoSave(updated);
  }, [selectedFrameId, frames, autoSave]);

  const handleDuplicateFramesAtPositions = useCallback((copies: { sourceId: string; x: number; y: number }[]) => {
    if (copies.length === 0) return;
    let frameNumber = nextFrameNumber(frames);
    const clones = copies.flatMap(({ sourceId, x, y }) => {
      const source = frames.find(frame => frame.id === sourceId);
      if (!source) return [];
      return [cloneFrame(source, x, y, `Frame ${frameNumber++}`)];
    });
    if (clones.length === 0) return;

        const updated = [...frames, ...clones];
    store.replaceAllWithUndo(updated, "edit");
    setSelectedFrameId(clones[0].id);
    setSelectedFrameIds(new Set(clones.map(frame => frame.id)));
    setSelectedElement(null);
    autoSave(updated);
  }, [frames, autoSave]);

  const handleLayerStackChange = useCallback((frameId: string, change: LayerStackChange) => {
    const frame = frames.find(item => item.id === frameId);
    if (!frame) return;

    const stackedCss = applyLayerStack(frame.css, change.siblingLayerIds);
    const updated = frames.map(item => item.id === frameId
      // REQ042: a design-side stack edit re-orders the DOM — the video z map
      // was keyed to the OLD order, so it resets (document order takes over).
      ? { ...item, html: change.html, css: stackedCss, layerZ: undefined }
      : item);
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
  }, [frames, autoSave]);

  const handleLayerDrop = useCallback((
    sourceFrameId: string,
    layerId: string,
    targetFrameId: string,
    targetLayerId: string | null,
    placement: LayerDropPlacement,
  ) => {
    const sourceFrame = frames.find(frame => frame.id === sourceFrameId);
    const targetFrame = frames.find(frame => frame.id === targetFrameId);
    if (!sourceFrame || !targetFrame) return;

    if (sourceFrameId === targetFrameId) {
      const change = reparentLayerInHtml(sourceFrame.html, layerId, targetLayerId, placement);
      if (!change) {
        addToast("No se puede mover una capa dentro de sí misma.", "error");
        return;
      }
      const updated = frames.map(frame => frame.id === sourceFrameId
        // REQ042: same-frame drop = structural reorder → z map resets.
        ? { ...frame, html: change.html, css: applyLayerStack(frame.css, change.siblingLayerIds), layerZ: undefined }
        : frame);
      store.replaceAllWithUndo(updated, "edit");
      setSelectedElement(null);
      autoSave(updated);
      return;
    }

    const extracted = extractLayerFromHtml(sourceFrame.html, layerId);
    if (!extracted) return;
    const remapped = remapLayerTreeForTarget(extracted.layerHtml, targetFrame.html, createLayerId);
    if (!remapped) return;
    const inserted = insertLayerIntoHtml(targetFrame.html, remapped.html, targetLayerId, placement);
    if (!inserted) {
      addToast("No se pudo insertar la capa en el destino.", "error");
      return;
    }

    const transferredCss = cloneLayerTreeCss(
      sourceFrame.css,
      extracted.layerHtml,
      extracted.layerIds,
      remapped.idMap,
    );
    const sourceCss = removeLayersCss(sourceFrame.css, extracted.layerIds);
    const combinedTargetCss = mergeCssRules(targetFrame.css, transferredCss);
    const targetCss = applyLayerStack(combinedTargetCss, inserted.siblingLayerIds);
    const updated = frames.map(frame => {
      // REQ042: both frames' layer stacks changed structurally → z maps reset.
      if (frame.id === sourceFrameId) return { ...frame, html: extracted.html, css: sourceCss, layerZ: undefined };
      if (frame.id === targetFrameId) return { ...frame, html: inserted.html, css: targetCss, layerZ: undefined };
      return frame;
    });

    store.replaceAllWithUndo(updated, "edit");
    setSelectedFrameId(targetFrameId);
    setSelectedFrameIds(new Set());
    setContentFrameId(targetFrameId);
    setSelectedElement(null);
    autoSave(updated);
  }, [frames, autoSave, addToast]);

  const handleFrameReorder = useCallback((
    sourceFrameId: string,
    targetFrameId: string,
    placement: LayerStackPlacement,
  ) => {
    if (sourceFrameId === targetFrameId) return;
    const reordered = [...frames];
    const sourceIndex = reordered.findIndex(frame => frame.id === sourceFrameId);
    if (sourceIndex < 0) return;
    const [source] = reordered.splice(sourceIndex, 1);
    const targetIndex = reordered.findIndex(frame => frame.id === targetFrameId);
    if (targetIndex < 0) return;
    reordered.splice(placement === "above" ? targetIndex : targetIndex + 1, 0, source);
    store.replaceAllWithUndo(reordered, "edit");
    autoSave(reordered);
  }, [frames, autoSave]);

  // ── Zoom helpers ──
  const handleZoomIn = useCallback(() => setZoom(z => Math.min(MAX_ZOOM, z + 0.1)), []);
  const handleZoomOut = useCallback(() => setZoom(z => Math.max(MIN_ZOOM, z - 0.1)), []);
  const handleZoomSet = useCallback((val: number) => setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, val))), []);
  const handleZoomToFit = useCallback(() => {
    const el = document.getElementById("canvas-container");
    if (!el || frames.length === 0) return;
    const b = frames.reduce(
      (a, f) => ({
        minX: Math.min(a.minX, f.x), minY: Math.min(a.minY, f.y),
        maxX: Math.max(a.maxX, f.x + f.width), maxY: Math.max(a.maxY, f.y + f.height),
      }),
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    const bw = b.maxX - b.minX + 200;
    const bh = b.maxY - b.minY + 200;
    const cw = el.clientWidth - 32;
    const ch = el.clientHeight - 32;
    setZoom(Math.round(Math.min(cw / bw, ch / bh, 1) * 100) / 100);
  }, [frames]);

  // ChatFAB's editor_zoom lands here: the AI zooms through the SAME handlers
  // as the trackpad pinch and the toolbar buttons, so the AI's view of the
  // canvas and the human's can never drift apart.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string; action?: string; zoom?: number; delta?: number }>).detail;
      if (!detail) return;
      if (detail.type === "frame") {
        // Musa Hands swipe (and any future ChatFAB tool): prev/next frame,
        // through the SAME handleSelectFrame as the timeline click.
        const fs = framesRef.current;
        if (fs.length === 0) return;
        const idx = fs.findIndex((f) => f.id === selectedFrameIdRef.current);
        const next = Math.max(0, Math.min(fs.length - 1, (idx < 0 ? 0 : idx) + (detail.delta || 0)));
        handleSelectFrame(fs[next].id);
        return;
      }
      if (detail.type !== "zoom") return;
      if (detail.action === "in") handleZoomIn();
      else if (detail.action === "out") handleZoomOut();
      else if (detail.action === "fit") handleZoomToFit();
      else if (detail.action === "set" && typeof detail.zoom === "number") handleZoomSet(detail.zoom);
    };
    window.addEventListener("futuraria:editor-viewport", handler);
    return () => window.removeEventListener("futuraria:editor-viewport", handler);
  }, [handleZoomIn, handleZoomOut, handleZoomToFit, handleZoomSet, handleSelectFrame]);

  // ── Musa Hands: gesture control (REQ Gesture Mode §6 bridge) ──
  // One effect owns the GestureManager lifecycle. Every gesture maps onto the
  // SAME channels a human hand uses: dispatchEditorViewport for pan/zoom/frame
  // (the ChatFAB channel), animationPlayback for play/stop/scrub (scrub gated
  // on the frame actually playing), and the DocumentStore for the pinch layer
  // drag — live replaceCanvasObjects while moving, ONE undo commit per grab.
  // Stable handle for the drag path: the manager never re-arms, so the actions
  // must survive autoSave/commit identity changes across renders.
  const commitCanvasObjectsRef = useRef(commitCanvasObjects);
  commitCanvasObjectsRef.current = commitCanvasObjects;
  useEffect(() => {
    if (!gestureOn) return;
    let disposed = false;
    let manager: GestureManager | null = null;
    // Pinch-drag state: grabbed orphans with their start positions (world px).
    let dragOrigin = new Map<string, { x: number; y: number }>();
    let scrubBase: number | null = null;
    const actions: GestureEditorActions = {
      pan: (dx, dy) => dispatchEditorViewport({ type: "pan", dx, dy }),
      zoom: (factor) => {
        // Continuous zoom: multiply from the live zoom through handleZoomSet's
        // clamp — never the 0.1-step buttons.
        dispatchEditorViewport({ type: "zoom", action: "set", zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomRef.current * factor)) });
      },
      dragStart: () => {
        const ids = [...selectedOrphanIdsRef.current];
        dragOrigin = new Map(
          canvasObjectsRef.current.filter((o) => ids.includes(o.id)).map((o) => [o.id, { x: o.x, y: o.y }]),
        );
        return dragOrigin.size > 0;
      },
      dragMove: (dx, dy) => {
        if (dragOrigin.size === 0) return;
        // Live, undo-free moves from the ORIGINAL grab positions (mirrored
        // screen px from the bridge, already in world scale at zoom 1:1).
        commitCanvasObjectsRef.current(
          canvasObjectsRef.current.map((o) => {
            const origin = dragOrigin.get(o.id);
            return origin ? { ...o, x: Math.round(origin.x + dx), y: Math.round(origin.y + dy) } : o;
          }),
          framesRef.current,
          "gestos: mover capa",
        );
      },
      dragEnd: () => {
        dragOrigin = new Map();
      },
      playStop: () => {
        const id = selectedFrameIdRef.current;
        if (!id) return;
        if (getFramePlayback(id).playing) stopFrame(id);
        else playFrame(id);
      },
      frameDelta: (delta) => dispatchEditorViewport({ type: "frame", delta }),
      scrubStart: () => {
        const id = selectedFrameIdRef.current;
        // Gate: the engine only honors seeks while its rAF is running.
        return !!id && getFramePlayback(id).playing;
      },
      scrubMove: (ds) => {
        const id = selectedFrameIdRef.current;
        if (!id) return;
        // Seeks are absolute: accumulate from the playhead at scrub start.
        if (scrubBase === null) scrubBase = getFramePlayback(id).timeSec;
        seekFrame(id, scrubBase + ds);
      },
      scrubEnd: () => {
        scrubBase = null;
      },
      toast: (message, kind) => addToast(message, kind),
      frameId: () => selectedFrameIdRef.current,
      isPlaying: (id) => (id ? getFramePlayback(id).playing : false),
      cursorMove: (x, y) => gestureCursorMove(x, y),
      cursorDown: (x, y) => gestureCursorDown(x, y),
      cursorUp: (x, y) => gestureCursorUp(x, y),
    };
    GestureManager.launch(actions)
      .then((m) => {
        if (disposed) void m.stop();
        else manager = m;
      })
      .catch(() => {
        // launch() already surfaced the failure through the HUD state.
      });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setGestureOn(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      disposed = true;
      window.removeEventListener("keydown", onKey, true);
      const m = manager;
      manager = null;
      void m?.stop();
    };
    // gestureOn is the only dep that may re-arm: everything else is read
    // through refs so the camera never blinks mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gestureOn]);

  /**
   * Applies a declaration to everything selected.
   *
   * These handlers each wrote to `selectedElement.selector` alone, so a tool
   * used on a multi-selection only ever reached one object. Selecting several
   * things and applying a tool means applying it to all of them.
   */
  const applyToSelection = useCallback((css: string, prop: string, value: string) => {
    if (!selectedElement) return css;
    let out = css;
    for (const target of styleTargets(selectedElement.selector, selectedElement.layerId, multiSelectLayerIds)) {
      out = updateCssProperty(out, target, prop, value);
    }
    return out;
  }, [selectedElement, multiSelectLayerIds]);

  // ── Font select ──
  const handleFontSelect = useCallback((fontFamily: string, meta?: { variants?: string[]; custom?: CustomFont }) => {
    if (!fontFamily || !selectedFrameId) return;
    setSelectedFont(fontFamily);
    setShowFontPicker(false);
    let newCss = activeCss;
    if (meta?.custom) {
      // A custom upload lives at its own URL — no webfont host can serve it.
      // The @font-face is persisted into the css (so reloads and exports see
      // it) and primed into this document and the live frames right now.
      newCss = ensureCustomFontImport(newCss, meta.custom);
      void loadCustomFontInDocument(meta.custom).catch(() => undefined);
      injectCustomFontIntoFrames(meta.custom);
    } else if (needsWebfont(fontFamily)) {
      // A system font arrives as its whole fallback stack, which is already
      // installed. Asking a webfont host for it builds a bogus request out of
      // the commas, and the silent fallback reads as the picker ignoring the
      // click.
      const family = primaryFamily(fontFamily);
      // The picker's variant list rides along: without it the frame only ever
      // loaded the default 400, and bold rendered as a faux face.
      newCss = ensureGoogleFontImport(newCss, family, meta?.variants);
      injectGoogleFontIntoFrames(family, meta?.variants);
    }
    // Quoting the whole stack would name a single family with commas in it,
    // which nothing has installed — the browser then falls back to its own
    // default serif, whatever font was actually picked.
    newCss = applyToSelection(newCss, "font-family", `${cssFontFamily(fontFamily)} !important`);
    handleCssChange(newCss);
  }, [activeCss, selectedFrameId, applyToSelection, handleCssChange]);

  // Font size, text colour and text alignment used to have their own handlers
  // here, feeding a formatting-only right-click menu. That menu is now a
  // command menu and the formatting lives in the contextual panel, which
  // already owns those controls.

  // ── Eyedropper: sample color and apply fill + stroke to selected element ──
  const handleEyedropperPick = useCallback((rawColor: string) => {
    const hex = toHexColor(rawColor);
    setForegroundColor(hex);
    // Apply fill (background-color) and stroke (border-color + outline-color)
    if (selectedElement && selectedFrameId) {
      let newCss = applyToSelection(activeCss, "background-color", `${hex} !important`);
      newCss = applyToSelection(newCss, "border-color", `${hex} !important`);
      newCss = applyToSelection(newCss, "outline-color", `${hex} !important`);
      handleCssChange(newCss);
    }
    setActiveTool("select");
  }, [selectedElement, selectedFrameId, activeCss, applyToSelection, handleCssChange]);

  /**
   * A drag carried layers clear of their frame, so they become canvas objects.
   *
   * Only a mouse drag does this. Nudging with the arrow keys, setting `left`
   * in the panel or an agent writing CSS all leave the layer where it is and
   * simply clipped — a frame clips on purpose, and a coordinate written by
   * hand is not someone dragging something out of a box.
   */
  const handleLayerEscape = useCallback((
    frameId: string,
    layerIds: string[],
    box: { x: number; y: number; width: number; height: number },
    geometries?: Record<string, LayerVisualGeometry>,
  ) => {
    const frame = framesRef.current.find(f => f.id === frameId);
    if (!frame) return;

    // The dragged union box in canvas coordinates decides where the layers
    // land: fully inside another frame → migrate there; otherwise → canvas.
    const canvasBox = {
      x: frame.x + box.x,
      y: frame.y + box.y,
      width: box.width,
      height: box.height,
    };
    const targetFrame = findFrameContainingCanvasRect(framesRef.current, canvasBox, frameId);

    const escaping: HtmlCanvasObject[] = [];
    let html = frame.html;
    let css = frame.css;
    let targetHtml = targetFrame?.html ?? "";
    let targetCss = targetFrame?.css ?? "";
    let zIndex = canvasObjectsRef.current.length + framesRef.current.length;

    for (const layerId of layerIds) {
      const extracted = extractLayerFromHtml(html, layerId);
      if (!extracted) continue;

      // The layer's own rules travel with it; the frame keeps none of them.
      let layerCss = extractLayerTreeCss(css, extracted.layerHtml, extracted.layerIds);
      const withoutLayer = deleteLayerFromHtml(html, layerId);
      if (withoutLayer === null) continue;
      html = withoutLayer;
      css = removeLayersCss(css, extracted.layerIds);

      const geometry = geometries?.[layerId] || {
        ...box,
        contentWidth: box.width,
        contentHeight: box.height,
        contentOffsetX: 0,
        contentOffsetY: 0,
      };
      const selector = `[data-layer-id="${layerId}"]`;
      layerCss = updateCssProperty(layerCss, selector, "position", "absolute");
      layerCss = updateCssProperty(layerCss, selector, "translate", "none !important");
      layerCss = updateCssProperty(layerCss, selector, "width", `${geometry.contentWidth}px !important`);
      layerCss = updateCssProperty(layerCss, selector, "height", `${geometry.contentHeight}px !important`);
      if (targetFrame) {
        // Same insertion handleMoveOrphanToFrame performs, with left/top
        // rewritten relative to the destination frame.
        const inserted = insertLayerIntoHtml(targetHtml, extracted.layerHtml, null, "inside");
        if (inserted) {
          targetHtml = inserted.html;
          layerCss = updateCssProperty(layerCss, selector, "left", `${Math.round(frame.x + geometry.x - targetFrame.x - geometry.contentOffsetX)}px !important`);
          layerCss = updateCssProperty(layerCss, selector, "top", `${Math.round(frame.y + geometry.y - targetFrame.y - geometry.contentOffsetY)}px !important`);
          targetCss = mergeCssRules(targetCss, layerCss);
        } else {
          continue;
        }
      } else {
        layerCss = updateCssProperty(layerCss, selector, "left", `${-geometry.contentOffsetX}px !important`);
        layerCss = updateCssProperty(layerCss, selector, "top", `${-geometry.contentOffsetY}px !important`);
        escaping.push({
          id: layerId,
          name: /data-layer-name=["']([^"']+)["']/i.exec(extracted.layerHtml)?.[1] || `Suelto ${escaping.length + 1}`,
          kind: inferCanvasObjectKind(extracted.layerHtml),
          frameId: null,
          html: extracted.layerHtml,
          css: layerCss,
          // Frame coordinates become canvas coordinates by adding the frame's own.
          x: Math.round(frame.x + geometry.x),
          y: Math.round(frame.y + geometry.y),
          width: Math.round(geometry.width) || 1,
          height: Math.round(geometry.height) || 1,
          zIndex: zIndex++,
        });
      }
    }

    if (targetFrame) {
      const movedFrames = framesRef.current.map(f => {
        if (f.id === frameId) return { ...f, html, css };
        if (f.id === targetFrame.id) return { ...f, html: targetHtml, css: targetCss };
        return f;
      });
      store.replaceAllWithUndo(movedFrames, "move to frame");
      autoSave(movedFrames);
      setSelectedElement(null);
      setMultiSelectLayerIds([]);
      setSelectedFrameId(targetFrame.id);
      setSelectedOrphanIds(new Set());
      addToast("El objeto entró al frame destino.", "success");
      return;
    }

    if (!escaping.length) return;

    const updatedFrames = framesRef.current.map(f => f.id === frameId ? { ...f, html, css } : f);
    commitCanvasObjects([...canvasObjectsRef.current, ...escaping], updatedFrames, "move to canvas");
    setSelectedElement(null);
    setMultiSelectLayerIds([]);
    setSelectedOrphanIds(new Set(escaping.map(o => o.id)));
    addToast(
      escaping.length === 1
        ? "El objeto salió del frame y ahora vive en el lienzo."
        : `${escaping.length} objetos salieron del frame.`,
      "success",
    );
  }, [commitCanvasObjects, addToast, store, autoSave]);

  // ── Element selection from DesignFrame ──
  const handleElementSelect = useCallback((info: SelectedElementInfo | null) => {
    setLayerSelectionRequest(null);
    setSelectedElement(info);
    if (info) {
      setSelectedFrameId(info.frameId);
      setSelectedFrameIds(new Set());
      setShowRightPanel(true);
      if (info.isSvg && info.svgChildTag === "path") {
        lastPenStyleRef.current = {
          fill: info.computedStyles.fill || "none",
          stroke: info.computedStyles.stroke || "#111827",
          strokeWidth: info.computedStyles["stroke-width"] || "2",
          strokeLinecap: info.computedStyles["stroke-linecap"] || "round",
          strokeLinejoin: info.computedStyles["stroke-linejoin"] || "round",
          strokeDasharray: info.computedStyles["stroke-dasharray"] || "none",
        };
      }
    }
  }, []);

  const handleElementNudge = useCallback((info: SelectedElementInfo, deltaX: number, deltaY: number) => {
    const frame = frames.find(item => item.id === info.frameId);
    if (!frame || info.movableLayers.length === 0) return;

    let updatedCss = frame.css;
    for (const layer of info.movableLayers) {
      const selector = `[data-layer-id="${layer.layerId}"]`;
      const currentLeft = getCssPropertyValue(updatedCss, selector, "left") || layer.left;
      const currentTop = getCssPropertyValue(updatedCss, selector, "top") || layer.top;
      const hasPixelPosition = /^-?\d+(?:\.\d+)?px/.test(currentLeft)
        || /^-?\d+(?:\.\d+)?px/.test(currentTop);
      if (layer.position === "static" || !hasPixelPosition) {
        const translate = parseTranslate(getCssPropertyValue(updatedCss, selector, "translate") || layer.translate);
        updatedCss = updateCssProperty(
          updatedCss,
          selector,
          "translate",
          `${translate.x + deltaX}px ${translate.y + deltaY}px !important`,
        );
        if (layer.display === "inline") {
          updatedCss = updateCssProperty(updatedCss, selector, "display", "inline-block !important");
        }
      } else {
        updatedCss = updateCssProperty(updatedCss, selector, "left", `${(parseFloat(currentLeft) || 0) + deltaX}px !important`);
        updatedCss = updateCssProperty(updatedCss, selector, "top", `${(parseFloat(currentTop) || 0) + deltaY}px !important`);
      }
    }
    handleFrameCssChange(info.frameId, updatedCss);
  }, [frames, handleFrameCssChange]);

  // ── Layer selection from Layers Panel → click element in canvas ──
  const handleSelectLayerElement = useCallback((frameId: string, layerId: string, path?: number[], additive = false) => {
    setSelectedFrameId(frameId);
    setSelectedFrameIds(new Set());
    setContentFrameId(frameId);
    // Shift+click acumula dentro y ENTRE frames: la lista plana alimenta
    // los handles de cada frame (ids únicos; cada frame filtra los suyos
    // contra su propio shadow DOM).
    setMultiSelectLayerIds(current => updateSelection(current, layerId, additive));
    // Cross-frame accumulation: Ctrl+click adds the layer no matter which
    // frame it lives in; a plain click restarts the selection with it.
    setCrossFrameTargets(current => {
      if (!additive) return [{ frameId, layerId }];
      // Toggle: Shift+click sobre un objeto YA seleccionado lo QUITA —
      // targets y la lista visual no pueden divergir, o align movería un
      // objeto que el usuario ya deseleccionó.
      const exists = current.some(t => t.frameId === frameId && t.layerId === layerId);
      if (exists) return current.filter(t => !(t.frameId === frameId && t.layerId === layerId));
      return [...current, { frameId, layerId }];
    });
    setLayerSelectionRequest({
      frameId,
      layerId,
      path,
      requestId: ++layerSelectionSequenceRef.current,
    });
  }, [selectedFrameId]);

  const handleLayerSelectionChange = useCallback((frameId: string, layerIds: string[], additive = false) => {
    // El frame reporta su lista LOCAL. Additive (Shift+click dentro del
    // frame de contenido): las entradas de otros frames siguen vivas.
    // Sin additive (click simple, marquee, click en vacío) el gesto ES la
    // selección completa: entradas viejas de otros frames NUNCA arrastran
    // — hacían que align moviera objetos ya deseleccionados.
    const frameHtml = frames.find(f => f.id === frameId)?.html ?? "";
    const ownedByReportedFrame = (id: string) => frameHtml.includes(`data-layer-id="${id}"`);
    setMultiSelectLayerIds(current => {
      if (!additive) return layerIds;
      const foreign = current.filter(id => !layerIds.includes(id) && !ownedByReportedFrame(id));
      return [...foreign, ...layerIds];
    });
    setCrossFrameTargets(current => {
      const foreign = additive ? current.filter(t => t.frameId !== frameId) : [];
      return [...foreign, ...layerIds.map(layerId => ({ frameId, layerId }))];
    });
    if (layerIds.length === 0) return;
    setSelectedFrameId(frameId);
    setSelectedFrameIds(new Set());
    setContentFrameId(frameId);
    setSelectedOrphanIds(new Set());
  }, [frames]);

  // ── Contextual panel CSS change ──
  const handleContextualCssChange = useCallback((newCss: string) => {
    handleCssChange(newCss);
  }, [handleCssChange]);

  // ── Add visual primitive to active frame ──
  const handleAddPrimitive = useCallback((type: "rect" | "circle" | "triangle" | "star" | "polygon" | "text", x: number, y: number, sides?: number, frameId?: string) => {
    // The clicked frame wins over the last-selected one, so the text tool
    // works with no prior selection and still lands in the right frame.
    const targetFrameId = frameId ?? selectedFrameId;
    if (!targetFrameId) return;
    const layerId = createLayerId();
    let html: string;
    let css: string;
    const defaultSize = type === "polygon" ? 120 : (type === "star" ? 130 : 150);
    if (type === "rect") {
      html = `<div data-layer-id="${layerId}" data-layer-name="Rectangle" data-layer-kind="shape" style="width:200px;height:150px;background-color:#3B82F6;border-radius:0;position:absolute;left:${x}px;top:${y}px;"></div>`;
      css = `[data-layer-id="${layerId}"] {\n  width: 200px;\n  height: 150px;\n  background-color: #3B82F6;\n  border-radius: 0;\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n}\n`;
    } else if (type === "circle") {
      html = `<div data-layer-id="${layerId}" data-layer-name="Circle" data-layer-kind="shape" style="width:150px;height:150px;background-color:#EF4444;border-radius:50%;position:absolute;left:${x}px;top:${y}px;"></div>`;
      css = `[data-layer-id="${layerId}"] {\n  width: 150px;\n  height: 150px;\n  background-color: #EF4444;\n  border-radius: 50%;\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n}\n`;
    } else if (type === "triangle") {
      const w = 150, h = 150;
      html = `<svg data-layer-id="${layerId}" data-layer-name="Triangle" data-layer-kind="svg" viewBox="0 0 ${w} ${h}" style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;overflow:visible;"><path d="M${w / 2} 0 L0 ${h} L${w} ${h} Z" fill="#10B981" stroke="#059669" stroke-width="0"/></svg>`;
      css = `[data-layer-id="${layerId}"] {\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n  width: ${w}px;\n  height: ${h}px;\n  overflow: visible;\n}\n`;
    } else if (type === "star") {
      const s = 130;
      const d = generateStarPath(s, 5, 0.4);
      html = `<svg data-layer-id="${layerId}" data-layer-name="Star" data-layer-kind="svg" data-shape="star" data-shape-count="5" data-shape-ratio="0.4" data-shape-corner-radius="0" data-shape-size="${s}" viewBox="0 0 ${s} ${s}" style="position:absolute;left:${x}px;top:${y}px;width:${s}px;height:${s}px;overflow:visible;"><path d="${d}" fill="#F59E0B" stroke="#D97706" stroke-width="0"/></svg>`;
      css = `[data-layer-id="${layerId}"] {\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n  width: ${s}px;\n  height: ${s}px;\n  overflow: visible;\n}\n`;
    } else if (type === "polygon") {
      const n = clampShapeCount(sides || 6);
      const s = 120;
      const d = generatePolygonPath(s, n);
      html = `<svg data-layer-id="${layerId}" data-layer-name="Polygon" data-layer-kind="svg" data-shape="polygon" data-shape-count="${n}" data-shape-corner-radius="0" data-shape-size="${s}" viewBox="0 0 ${s} ${s}" style="position:absolute;left:${x}px;top:${y}px;width:${s}px;height:${s}px;overflow:visible;"><path d="${d}" fill="#8B5CF6" stroke="#7C3AED" stroke-width="0"/></svg>`;
      css = `[data-layer-id="${layerId}"] {\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n  width: ${s}px;\n  height: ${s}px;\n  overflow: visible;\n}\n`;
    } else {
      html = `<div data-layer-id="${layerId}" data-layer-name="Text" data-layer-kind="text" style="font-size:24px;color:#333;position:absolute;left:${x}px;top:${y}px;">Type something</div>`;
      css = `[data-layer-id="${layerId}"] {\n  font-size: 24px;\n  color: #333;\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n}\n`;
    }
    const updated = frames.map(f =>
      f.id === targetFrameId
        ? { ...f, html: f.html + "\n" + html, css: f.css + "\n" + css }
        : f
    );
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
    setAutoEditLayerId(layerId); // Sprint 3.5: auto-edit new text
    if (type === "text") {
      // The contextual panel must already be on the new text: font picker
      // visible without an extra click (it only renders on this tab).
      setShowRightPanel(true);
      setRightPanelTab("contextual");
      setContextualSubTab("properties");
    }
    setActiveTool("select"); // Switch back to select after placing
  }, [selectedFrameId, frames, autoSave]);

  // ── Phase C: Draw shape with exact dimensions (drag-to-draw) ──
  const handleDrawShape = useCallback((type: "rect" | "circle" | "triangle" | "star" | "polygon", x: number, y: number, w: number, h: number, sides?: number) => {
    if (!selectedFrameId) return;
    const layerId = createLayerId();
    let html: string;
    let css: string;
    if (type === "rect") {
      html = `<div data-layer-id="${layerId}" data-layer-name="Rectangle" data-layer-kind="shape"></div>`;
      css = `[data-layer-id="${layerId}"] {\n  width: ${w}px;\n  height: ${h}px;\n  background-color: #3B82F6;\n  border-radius: 0;\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n}\n`;
    } else if (type === "circle") {
      html = `<div data-layer-id="${layerId}" data-layer-name="Circle" data-layer-kind="shape"></div>`;
      css = `[data-layer-id="${layerId}"] {\n  width: ${w}px;\n  height: ${h}px;\n  background-color: #EF4444;\n  border-radius: 50%;\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n}\n`;
    } else if (type === "triangle") {
      html = `<svg data-layer-id="${layerId}" data-layer-name="Triangle" data-layer-kind="svg" viewBox="0 0 ${w} ${h}" style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;overflow:visible;"><path d="M${w / 2} 0 L0 ${h} L${w} ${h} Z" fill="#10B981" stroke="#059669" stroke-width="0"/></svg>`;
      css = `[data-layer-id="${layerId}"] {\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n  width: ${w}px;\n  height: ${h}px;\n  overflow: visible;\n}\n`;
    } else if (type === "star") {
      const s = Math.max(w, h);
      const d = generateStarPath(s, 5, 0.4);
      html = `<svg data-layer-id="${layerId}" data-layer-name="Star" data-layer-kind="svg" data-shape="star" data-shape-count="5" data-shape-ratio="0.4" data-shape-corner-radius="0" data-shape-size="${s}" viewBox="0 0 ${s} ${s}" style="position:absolute;left:${x}px;top:${y}px;width:${s}px;height:${s}px;overflow:visible;"><path d="${d}" fill="#F59E0B" stroke="#D97706" stroke-width="0"/></svg>`;
      css = `[data-layer-id="${layerId}"] {\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n  width: ${s}px;\n  height: ${s}px;\n  overflow: visible;\n}\n`;
    } else {
      // polygon — parametric path with configurable sides
      const n = clampShapeCount(sides || 6);
      const s = Math.max(w, h);
      const d = generatePolygonPath(s, n);
      html = `<svg data-layer-id="${layerId}" data-layer-name="Polygon" data-layer-kind="svg" data-shape="polygon" data-shape-count="${n}" data-shape-corner-radius="0" data-shape-size="${s}" viewBox="0 0 ${s} ${s}" style="position:absolute;left:${x}px;top:${y}px;width:${s}px;height:${s}px;overflow:visible;"><path d="${d}" fill="#8B5CF6" stroke="#7C3AED" stroke-width="0"/></svg>`;
      css = `[data-layer-id="${layerId}"] {\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n  width: ${s}px;\n  height: ${s}px;\n  overflow: visible;\n}\n`;
    }
    const updated = frames.map(f =>
      f.id === selectedFrameId
        ? { ...f, html: f.html + "\n" + html, css: f.css + "\n" + css }
        : f
    );
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
    setActiveTool("select");
  }, [selectedFrameId, frames, autoSave]);

  // ── Phase C: Inline text editing ──
  const handleTextChange = useCallback((layerId: string, newText: string) => {
    if (!selectedFrameId) return;
    const frame = frames.find(f => f.id === selectedFrameId);
    if (!frame) return;
    const newHtml = replaceLayerText(frame.html, layerId, newText);
    if (newHtml === null) return;
    const updated = frames.map(f =>
      f.id === selectedFrameId ? { ...f, html: newHtml } : f
    );
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
  }, [selectedFrameId, frames, autoSave]);

  const handleEditPathPoints = useCallback((frameId: string, layerId: string, newPathD: string) => {
    const frame = frames.find(candidate => candidate.id === frameId);
    if (!frame) return;
    const analysis = analyzePathData(newPathD);
    const newHtml = replaceLayerPathData(frame.html, layerId, newPathD, {
      "data-bezier-model": "chained-cubic",
      "data-bezier-degeneracy": analysis.degeneracy,
      "data-bezier-self-intersections": String(analysis.selfIntersections),
      "data-bezier-singularities": String(analysis.singularities),
    });
    if (newHtml === null || newHtml === frame.html) return;
    // F1: editing a path that masks an image re-bakes the mask's CSS so the
    // clip follows the corrected curve.
    const reBaked = reBakePathMask(newHtml, frame.css, layerId);
    const updated = frames.map(candidate => candidate.id === frameId
      ? { ...candidate, html: reBaked?.html ?? newHtml, css: reBaked?.css ?? candidate.css }
      : candidate);
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
  }, [frames, autoSave]);

  // ── F1: masks from closed bezier paths (right-click "selección") ──
  const commitMaskChange = useCallback((
    frameId: string,
    result: { html: string; css: string } | null,
    successMessage: string,
    failureMessage: string,
  ) => {
    if (!result) {
      addToast(failureMessage, "error");
      return;
    }
    const updated = frames.map(f => f.id === frameId ? { ...f, html: result.html, css: result.css } : f);
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
    addToast(successMessage, "success");
  }, [frames, autoSave, addToast]);

  const handleCreateSelection = useCallback((frameId: string, pathLayerId: string, imageLayerId: string, mode: MaskMode) => {
    const frame = frames.find(f => f.id === frameId);
    if (!frame) return;
    const result = applyPathMask(frame.html, frame.css, pathLayerId, imageLayerId, mode);
    commitMaskChange(
      frameId,
      result,
      mode === "include" ? "Selección creada: el exterior queda recortado (editable con el trazado)." : "Selección invertida: ahora se conserva el exterior.",
      "No se pudo crear la selección: el trazado y la imagen deben estar posicionados en px dentro del frame.",
    );
  }, [frames, commitMaskChange]);

  const handleInvertSelection = useCallback((frameId: string, pathLayerId: string, imageLayerId: string, currentMode: MaskMode | null) => {
    handleCreateSelection(frameId, pathLayerId, imageLayerId, currentMode === "exclude" ? "include" : "exclude");
  }, [handleCreateSelection]);

  const handleFillSelection = useCallback((frameId: string, pathLayerId: string, imageLayerId: string, color: string) => {
    const frame = frames.find(f => f.id === frameId);
    if (!frame) return;
    const result = applySelectionFill(frame.html, frame.css, pathLayerId, imageLayerId, color);
    commitMaskChange(frameId, result, `Selección rellenada con ${color}.`, "No se pudo rellenar la selección.");
  }, [frames, commitMaskChange]);

  // ── F4: Borrador brush strokes (non-destructive mask editing) ──
  // Each completed drag arrives as one stroke in image-local coordinates;
  // applyBrushStroke appends it to data-mask-brushes and re-bakes the mask.
  // Silent on success — strokes are frequent, and the mask updating live is
  // its own feedback.
  const handleBrushStroke = useCallback((frameId: string, imageLayerId: string, stroke: BrushStroke) => {
    const frame = frames.find(f => f.id === frameId);
    if (!frame) return;
    const result = applyBrushStroke(frame.html, frame.css, imageLayerId, stroke);
    if (!result) {
      addToast("No se pudo aplicar el trazo del borrador: la imagen no tiene una caja en px.", "error");
      return;
    }
    const updated = frames.map(f => f.id === frameId ? { ...f, html: result.html, css: result.css } : f);
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
  }, [frames, autoSave, addToast]);

  // ── F1/F2/F4: Quitar máscara (one-click mask revert) ──
  // Strips the mask CSS, the stored strokes and the mask source layer in one
  // commit — the eraser's "how do I undo this" answer beyond per-stroke Ctrl+Z.
  const handleImageMaskRemove = useCallback((frameId: string, imageLayerId: string) => {
    const frame = frames.find(f => f.id === frameId);
    if (!frame) return;
    const result = removeImageMask(frame.html, frame.css, imageLayerId);
    commitMaskChange(
      frameId,
      result,
      "Máscara quitada: la imagen vuelve a mostrarse completa.",
      "No se pudo quitar la máscara de esta imagen.",
    );
  }, [frames, commitMaskChange]);

  // ── F2/F2b: Varita — SAM clicks or CLIPSeg text over an image layer ──
  // Shared pipeline: POST /api/segment/click, poll until done, apply the
  // traced outline as the F1 mask path (non-destructive, data-mask-for).
  const runSegmentJob = useCallback(async (
    payload: { url: string; points?: WandClickPoint[]; prompt?: string },
    frameId: string,
    imageLayerId: string,
  ): Promise<boolean> => {
    const res = await fetch("/api/segment/click", {
      method: "POST",
      headers: { ...getApiHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, workspaceId: templateWorkspaceId }),
    }).then(r => r.json());
    if (!res?.success) throw new Error(res?.error || "segment_click failed");

    // Warm model returns immediately; a cold start stays pollable here so
    // the interaction still feels synchronous (same pattern as F3).
    let result = res.result || null;
    if (res.jobId && !result) {
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        const poll = await fetch(`/api/segment/jobs/${res.jobId}`, { headers: getApiHeaders() }).then(r => r.json());
        if (poll?.success && poll.status === "done") { result = poll.result; break; }
        if (poll?.success && poll.status === "error") throw new Error(poll.error || "Inference failed");
      }
    }
    const dNorm: string | undefined = result?.svgPath?.dNorm;
    if (!dNorm) throw new Error("The job did not produce a mask path");

    const frame = framesRef.current.find(f => f.id === frameId);
    if (!frame) return false;
    const applied = applySegmentMaskPath(frame.html, frame.css, imageLayerId, dNorm);
    if (!applied) return false;
    const updated = framesRef.current.map(f => f.id === frameId ? { ...f, html: applied.html, css: applied.css } : f);
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
    return true;
  }, [templateWorkspaceId, store, autoSave]);

  const handleWandSegment = useCallback(async (frameId: string, imageLayerId: string, src: string, points: WandClickPoint[]) => {
    setWandBusy(imageLayerId);
    try {
      const applied = await runSegmentJob({ url: src, points }, frameId, imageLayerId);
      if (applied) addToast("Selección aplicada con la Varita.", "success");
      else addToast("No se pudo aplicar la selección de la varita.", "error");
    } catch (err: any) {
      console.error("[WAND] failed:", err);
      addToast(`Varita: ${err?.message || "segmentación fallida"}`, "error");
    } finally {
      setWandBusy(null);
    }
  }, [runSegmentJob, addToast]);

  // ── F2b: Varita por texto (CLIPSeg) — segments the selected image layer ──
  const handleWandPromptRun = useCallback(async () => {
    const prompt = wandPrompt.trim();
    if (!prompt) {
      addToast("Escribe qué segmentar (ej: la persona).", "info");
      return;
    }
    if (!selectedElement || selectedElement.frameId !== selectedFrameId || selectedElement.tag.toLowerCase() !== "img" || !selectedElement.src) {
      addToast("Selecciona una imagen para segmentar por texto.", "info");
      return;
    }
    const imageLayerId = selectedElement.layerId;
    const src = selectedElement.src;
    setWandBusy(imageLayerId);
    try {
      const applied = await runSegmentJob({ url: src, prompt }, selectedFrameId, imageLayerId);
      if (applied) addToast(`Segmentación «${prompt}» aplicada.`, "success");
      else addToast("No se pudo aplicar la segmentación por texto.", "error");
    } catch (err: any) {
      console.error("[WAND-PROMPT] failed:", err);
      addToast(`Varita: ${err?.message || "segmentación fallida"}`, "error");
    } finally {
      setWandBusy(null);
    }
  }, [wandPrompt, selectedElement, selectedFrameId, runSegmentJob, addToast]);

  // ── Phase E: Pen path creation (supports closed paths) ──
  const handleAddPenPath = useCallback((pathData: string, bounds: { x: number; y: number; width: number; height: number }, closed?: boolean) => {
    if (!selectedFrameId) return;
    const layerId = createLayerId();
    const style = lastPenStyleRef.current;
    const fill = closed && style.fill === "none" ? "#3B82F6" : style.fill;
    const analysis = analyzePathData(pathData, Boolean(closed));
    const svgHtml = `<svg data-layer-id="${layerId}" data-layer-name="Bezier" data-layer-kind="bezier" data-bezier-model="chained-cubic" data-bezier-degeneracy="${analysis.degeneracy}" data-bezier-self-intersections="${analysis.selfIntersections}" data-bezier-singularities="${analysis.singularities}" viewBox="${bounds.x} ${bounds.y} ${Math.max(bounds.width, 1)} ${Math.max(bounds.height, 1)}" style="position:absolute;left:${bounds.x}px;top:${bounds.y}px;width:${Math.max(bounds.width, 1)}px;height:${Math.max(bounds.height, 1)}px;overflow:visible;"><path d="${pathData}"/></svg>`;
    const css = `[data-layer-id="${layerId}"] {\n  position: absolute;\n  left: ${bounds.x}px;\n  top: ${bounds.y}px;\n  width: ${Math.max(bounds.width, 1)}px;\n  height: ${Math.max(bounds.height, 1)}px;\n  overflow: visible;\n}\n[data-layer-id="${layerId}"] path {\n  fill: ${fill};\n  stroke: ${style.stroke};\n  stroke-width: ${style.strokeWidth};\n  stroke-linecap: ${style.strokeLinecap};\n  stroke-linejoin: ${style.strokeLinejoin};\n  stroke-dasharray: ${style.strokeDasharray};\n}\n`;
    const updated = frames.map(f =>
      f.id === selectedFrameId
        ? { ...f, html: f.html + "\n" + svgHtml, css: f.css + "\n" + css }
        : f
    );
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
    setActiveTool("select");
    if (analysis.degeneracy === "point") {
      addToast("El trazado degeneró en un punto. Se conservó para que puedas corregir sus anclas.", "error");
    } else if (analysis.selfIntersections > 0 || analysis.singularities > 0) {
      addToast(`Trazado creado con ${analysis.selfIntersections} auto-intersección(es) y ${analysis.singularities} punto(s) singular(es).`, "info");
    }
  }, [selectedFrameId, frames, autoSave, addToast]);

  // ── Frame tool (F/A): click = 100×100 frame, drag = custom dimensions ──
  const handleCreateFrameAt = useCallback((x: number, y: number, w: number, h: number) => {
    const newFrame: FrameData = {
      id: createFrameId(),
      name: `Frame ${nextFrameNumber(frames)}`,
      x, y, width: w, height: h,
      html: "",
      css: `body {\n  font-family: 'Inter', system-ui, sans-serif;\n  position: relative;\n  width: ${w}px;\n  height: ${h}px;\n  margin: 0;\n  background-color: #ffffff;\n  overflow: hidden;\n}\n`,
      background: "#ffffff",
    };
        const updated = [...frames, newFrame];
    store.replaceAllWithUndo(updated, "edit");
    setSelectedFrameId(newFrame.id);
    setSelectedFrameIds(new Set([newFrame.id]));
    autoSave(updated);
    setActiveTool("select");
  }, [frames, autoSave]);

  // ── Text tool drag: fixed-size text box (click creates auto-width text) ──
  const handleAddTextBox = useCallback((x: number, y: number, w: number, h: number, initialText?: string, frameId?: string) => {
    const targetFrameId = frameId ?? selectedFrameId;
    if (!targetFrameId) return;
    const layerId = createLayerId();
    const text = (initialText ?? "Type something")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const html = `<div data-layer-id="${layerId}" data-layer-name="Text" data-layer-kind="text" data-text-resizing="fixed" style="font-size:24px;color:#333;position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;overflow:hidden;">${text}</div>`;
    const css = `[data-layer-id="${layerId}"] {\n  font-size: 24px;\n  color: #333;\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n  width: ${w}px;\n  height: ${h}px;\n  overflow: hidden;\n}\n`;
    const updated = frames.map(f =>
      f.id === targetFrameId
        ? { ...f, html: f.html + "\n" + html, css: f.css + "\n" + css }
        : f
    );
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
    setAutoEditLayerId(layerId); // Sprint 3.5: auto-edit new text
    // The contextual panel must already be on the new text: font picker
    // visible without an extra click (it only renders on this tab).
    setShowRightPanel(true);
    setRightPanelTab("contextual");
    setContextualSubTab("properties");
    setActiveTool("select");
  }, [selectedFrameId, frames, autoSave]);

  // Pasting plain OS-clipboard text (not something copied from inside this
  // editor) creates a new text block with that content, dropped near the
  // center of whichever frame is selected.
  const handlePasteTextAsBlock = useCallback((text: string) => {
    if (!selectedFrameId) { addToast("Selecciona un frame primero.", "error"); return; }
    const frame = frames.find(f => f.id === selectedFrameId);
    if (!frame) return;
    const w = Math.min(400, Math.max(160, frame.width - 80));
    const h = 120;
    const x = Math.max(20, Math.round((frame.width - w) / 2));
    const y = Math.max(20, Math.round((frame.height - h) / 2));
    handleAddTextBox(x, y, w, h, text);
  }, [selectedFrameId, frames, handleAddTextBox, addToast]);

  // Shared "apply parsed HTML/CSS as a frame" logic — used by both the
  // PasteHtmlModal (manual import) and the native-paste "paste as image" path.
  // Pasted code from an external chat (told to mark icons with data-icon-hint
  // instead of drawing them itself — see the icon-hint convention shared with
  // image_to_design/import_design) gets those placeholders swapped for real
  // Phosphor SVGs before the frame is created. Only fires when the marker is
  // actually present, so ordinary pastes take the exact same synchronous path
  // as before.
  const applyPastedHtmlAsFrame = useCallback(async (result: PasteResult) => {
    if (result.html?.includes("data-icon-hint")) {
      try {
        const res = await apiFetch<any>("/mcp", {
          method: "POST",
          body: JSON.stringify({ jsonrpc: "2.0", method: "resolve_icon_hints", params: { html: result.html }, id: 1 }),
        });
        const content = res?.result?.content?.[0];
        const data = content?.type === "text" && content.text ? JSON.parse(content.text) : null;
        if (data?.html) result = { ...result, html: data.html };
      } catch { /* fall through and apply the unresolved HTML rather than block the paste */ }
    }
    const w = result.width || 1080;
    const h = result.height || 1080;
    if (selectedFrameId) {
      const updated = frames.map(f =>
        f.id === selectedFrameId ? { ...f, html: result.html, css: result.css } : f
      );
      store.replaceAllWithUndo(updated, "edit");
      autoSave(updated);
      openCodeTab();
    } else {
      const pos = (() => {
        if (frames.length === 0) return { x: 100, y: 100 };
        const last = frames[frames.length - 1];
        return { x: last.x + last.width + FRAME_GAP, y: last.y };
      })();
      const newFrame: FrameData = {
        id: createFrameId(),
        name: `Frame ${nextFrameNumber(frames)}`,
        x: pos.x, y: pos.y,
        width: w, height: h,
        html: result.html,
        css: result.css,
        background: "#ffffff",
      };
      const updated = [...frames, newFrame];
      store.replaceAllWithUndo(updated, "edit");
      setSelectedFrameId(newFrame.id);
      setSelectedFrameIds(new Set([newFrame.id]));
      autoSave(updated);
      openCodeTab();
    }
  }, [selectedFrameId, frames, autoSave, openCodeTab]);

  // Detects clipboard text that's plausibly a renderable design (HTML doc/fragment
  // or a JSON template) rather than plain prose — used to trigger the paste-choice dialog.
  const looksLikeRenderableCode = useCallback((text: string): boolean => {
    const trimmed = text.trim();
    if (!trimmed) return false;
    if (/^<!doctype html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) return true;
    // A handful of real HTML tags (not just one stray "<" in prose)
    const tagMatches = trimmed.match(/<\/?(div|span|section|header|footer|nav|button|img|a|p|h[1-6]|ul|li|table|style)\b/gi);
    if (tagMatches && tagMatches.length >= 2) return true;
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object" && (parsed.html || parsed.frames || parsed.css)) return true;
      } catch { /* not valid JSON — fall through */ }
    }
    return false;
  }, []);

  const PASTE_SNOOZE_KEY = "futuraria:pasteImagePromptSnoozeUntil";
  const isPasteImagePromptSnoozed = useCallback((): boolean => {
    const raw = localStorage.getItem(PASTE_SNOOZE_KEY);
    if (!raw) return false;
    const until = parseInt(raw, 10);
    return Number.isFinite(until) && Date.now() < until;
  }, []);
  const snoozePasteImagePrompt = useCallback((days: number) => {
    const until = Date.now() + days * 24 * 60 * 60 * 1000;
    localStorage.setItem(PASTE_SNOOZE_KEY, String(until));
  }, []);

  const [pasteChoiceText, setPasteChoiceText] = useState<string | null>(null);
  const [pasteChoiceSnoozeDays, setPasteChoiceSnoozeDays] = useState(7);
  const [pasteChoiceSnoozeEnabled, setPasteChoiceSnoozeEnabled] = useState(false);

  const resolvePasteAsImage = useCallback(async (text: string) => {
    try {
      const trimmed = text.trim();
      if (trimmed.startsWith("{")) {
        const parsed = JSON.parse(trimmed);
        await applyPastedHtmlAsFrame({ html: parsed.html || "", css: parsed.css || "", width: parsed.width, height: parsed.height });
      } else {
        const parsed = parseHtmlDocument(trimmed);
        await applyPastedHtmlAsFrame({ html: parsed.html, css: parsed.css, width: parsed.width, height: parsed.height });
      }
      addToast("✓ Pegado como diseño", "success");
    } catch {
      addToast("No se pudo interpretar el contenido pegado, se pegó como texto.", "error");
      handlePasteTextAsBlock(text);
    }
  }, [applyPastedHtmlAsFrame, handlePasteTextAsBlock, addToast]);

  const handlePasteChoiceConfirm = useCallback((asImage: boolean) => {
    const text = pasteChoiceText;
    if (pasteChoiceSnoozeEnabled) snoozePasteImagePrompt(pasteChoiceSnoozeDays);
    setPasteChoiceText(null);
    if (!text) return;
    if (asImage) resolvePasteAsImage(text);
    else handlePasteTextAsBlock(text);
  }, [pasteChoiceText, pasteChoiceSnoozeEnabled, pasteChoiceSnoozeDays, snoozePasteImagePrompt, resolvePasteAsImage, handlePasteTextAsBlock]);

  // ── Wrap selection in a frame (Ctrl+Alt+G) — Figma-style "frame selection" ──
  // Measures layer geometry in frame coordinates, through the frame's shadow DOM.
  // The stylesheet alone cannot answer this: an auto-sized text carries no width
  // or height rule, so anything that needs a real box — aligning to a right or
  // centre edge, wrapping a selection — has to read the rendered result.
  const measureLayerRects = useCallback((frameId: string, layerIds: string[]) => {
    const wrapper = document.querySelector(`[data-frame-id="${frameId}"]`);
    const host = wrapper && [...wrapper.querySelectorAll("div")].find(el => el.shadowRoot?.getElementById("__df_content"));
    const content = host?.shadowRoot?.getElementById("__df_content");
    if (!content) return null;
    const contentRect = content.getBoundingClientRect();
    const scale = zoom || 1;
    const rects: Array<{ layerId: string; left: number; top: number; width: number; height: number }> = [];
    for (const layerId of layerIds) {
      const element = content.querySelector(`[data-layer-id="${layerId}"]`);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      rects.push({
        layerId,
        left: (rect.left - contentRect.left) / scale,
        top: (rect.top - contentRect.top) / scale,
        width: rect.width / scale,
        height: rect.height / scale,
      });
    }
    return rects;
  }, [zoom]);

  // Nests the selected layers inside a new frame container that becomes their
  // coordinate system.
  const handleWrapSelectionInFrame = useCallback(() => {
    if (!selectedFrameId) return;
    const layerIds = multiSelectLayerIds.length > 0
      ? multiSelectLayerIds
      : selectedElement && selectedElement.frameId === selectedFrameId && selectedElement.layerId
        ? [selectedElement.layerId]
        : [];
    if (layerIds.length === 0) {
      addToast("Selecciona una o más capas para envolverlas en un frame.", "info");
      return;
    }
    const frame = frames.find(candidate => candidate.id === selectedFrameId);
    if (!frame) return;

    const rects = measureLayerRects(selectedFrameId, layerIds);
    if (!rects) {
      addToast("No se encontró una de las capas seleccionadas.", "error");
      return;
    }

    const minX = Math.floor(Math.min(...rects.map(r => r.left)));
    const minY = Math.floor(Math.min(...rects.map(r => r.top)));
    const maxX = Math.ceil(Math.max(...rects.map(r => r.left + r.width)));
    const maxY = Math.ceil(Math.max(...rects.map(r => r.top + r.height)));
    const frameLayerId = createLayerId();
    const newHtml = wrapLayersInFrame(
      frame.html,
      rects.map(r => ({
        layerId: r.layerId,
        left: Math.round(r.left - minX),
        top: Math.round(r.top - minY),
        width: Math.round(r.width),
        height: Math.round(r.height),
      })),
      {
        layerId: frameLayerId,
        name: "Frame",
        left: minX,
        top: minY,
        width: Math.max(1, maxX - minX),
        height: Math.max(1, maxY - minY),
      },
    );
    if (!newHtml) {
      addToast("Las capas deben compartir el mismo padre para envolverlas.", "error");
      return;
    }
    const updated = frames.map(candidate =>
      candidate.id === selectedFrameId ? { ...candidate, html: newHtml } : candidate
    );
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
    setMultiSelectLayerIds([]);
    addToast(`${rects.length} capa(s) envuelta(s) en un frame.`, "success");
  }, [selectedFrameId, multiSelectLayerIds, selectedElement, frames, zoom, autoSave, addToast]);

  // ── Parametric shape options: star/polygon count, star ratio, corner radius ──
  const handleShapeOptionsChange = useCallback((layerId: string, frameId: string, options: ShapeOptions) => {
    const frame = frames.find(candidate => candidate.id === frameId);
    if (!frame) return;

    // ── F4: shapes with hand-edited vertices keep their geometry. Only the
    // radius can be re-applied (recovered from the current path); a count or
    // ratio change would rebuild the shape from parameters and wipe edits. ──
    const shapeDoc = new DOMParser().parseFromString(frame.html, "text/html");
    const shapeLayer = shapeDoc.querySelector(`[data-layer-id="${layerId}"]`);
    if (shapeLayer?.getAttribute("data-shape-custom") === "1") {
      const shapePath = shapeLayer.tagName.toLowerCase() === "path" ? shapeLayer : shapeLayer.querySelector("path");
      const currentD = shapePath?.getAttribute("d") || null;
      const corners = currentD ? cornersFromShapePath(currentD) : null;
      if (corners) {
        const nextRadius = Math.max(0, options.cornerRadius || 0);
        const nextD = verticesToPath(corners, corners.map(() => nextRadius));
        const customHtml = replaceLayerPathData(frame.html, layerId, nextD, {
          "data-shape-corner-radius": String(nextRadius),
          "data-vr": serializeVertexRadiiAttr(corners.map(() => nextRadius)),
          "data-shape-custom": "1",
        });
        if (customHtml && customHtml !== frame.html) {
          const customUpdated = frames.map(candidate => candidate.id === frameId ? { ...candidate, html: customHtml } : candidate);
          store.replaceAllWithUndo(customUpdated, "edit");
          autoSave(customUpdated);
        }
      }
      return; // count/ratio changes are ignored on custom-edited shapes
    }

    const size = options.size || 120;
    const count = clampShapeCount(options.count);
    const d = options.shape === "star"
      ? generateStarPath(size, count, options.ratio, options.cornerRadius)
      : generatePolygonPath(size, count, options.cornerRadius);
    const newHtml = replaceLayerPathData(frame.html, layerId, d, {
      "data-shape": options.shape,
      "data-shape-count": String(count),
      "data-shape-ratio": String(options.ratio),
      "data-shape-corner-radius": String(options.cornerRadius),
      "data-shape-size": String(size),
    });
    if (newHtml === null || newHtml === frame.html) return;
    const updated = frames.map(candidate => candidate.id === frameId ? { ...candidate, html: newHtml } : candidate);
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
  }, [frames, autoSave]);

  // ── F4: per-vertex radius edits (Appearance panel's per-vertex submenu). ──
  const handleShapeVertexRadiusChange = useCallback((layerId: string, frameId: string, index: number | "all", value: number) => {
    const frame = frames.find(candidate => candidate.id === frameId);
    if (!frame) return;
    const doc = new DOMParser().parseFromString(frame.html, "text/html");
    const layer = doc.querySelector(`[data-layer-id="${layerId}"]`);
    if (!layer) return;
    const path = layer.tagName.toLowerCase() === "path" ? layer : layer.querySelector("path");
    const d = path?.getAttribute("d");
    if (!path || !d) return;
    const corners = cornersFromShapePath(d);
    if (!corners) return;
    const uniform = Number(layer.getAttribute("data-shape-corner-radius") ?? path.getAttribute("data-shape-corner-radius")) || 0;
    const current = parseVertexRadiiAttr(layer.getAttribute("data-vr") ?? path.getAttribute("data-vr"), uniform, corners.length);
    const next = index === "all"
      ? corners.map(() => value)
      : current.map((radius, position) => position === index ? value : radius);
    const newD = verticesToPath(corners, next);
    const newHtml = replaceLayerPathData(frame.html, layerId, newD, {
      "data-shape-corner-radius": index === "all" ? String(Math.round(value * 10) / 10) : String(uniform),
      "data-vr": serializeVertexRadiiAttr(next),
      "data-shape-custom": "1",
    });
    if (newHtml === null || newHtml === frame.html) return;
    const updated = frames.map(candidate => candidate.id === frameId ? { ...candidate, html: newHtml } : candidate);
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
  }, [frames, autoSave]);

  // ── Text on Path: write text along an existing SVG path ──
  const handleAddTextPath = useCallback((pathData: string, bounds: { x: number; y: number; width: number; height: number }, clickX: number, clickY: number, startOffset: number, originalViewBox?: string) => {
    if (!selectedFrameId) return;
    const layerId = createLayerId();
    const pathId = `tp_${Date.now().toString(36)}`;
    // Use original SVG viewBox if available; otherwise fall back to screen-space bounds
    const vb = originalViewBox
      ? originalViewBox.split(/\s+/).map(Number)
      : [bounds.x, bounds.y, Math.max(bounds.width, 1), Math.max(bounds.height, 1)];
    const svgHtml = `<svg data-layer-id="${layerId}" data-layer-name="Text on path" data-layer-kind="text" viewBox="${vb[0]} ${vb[1]} ${Math.max(vb[2], 1)} ${Math.max(vb[3], 1)}" style="position:absolute;left:${bounds.x}px;top:${bounds.y}px;width:${Math.max(bounds.width, 1)}px;height:${Math.max(bounds.height, 1)}px;overflow:visible;"><defs><path id="${pathId}" d="${pathData}"/></defs><text fill="#c4c0b4" font-size="18" font-family="inherit"><textPath href="#${pathId}" startOffset="${startOffset}%">Text</textPath></text></svg>`;
    const css = `[data-layer-id="${layerId}"] {
  position: absolute;
  left: ${bounds.x}px;
  top: ${bounds.y}px;
  width: ${Math.max(bounds.width, 1)}px;
  height: ${Math.max(bounds.height, 1)}px;
  overflow: visible;
}
`;
    const updated = frames.map(f =>
      f.id === selectedFrameId
        ? { ...f, html: f.html + "\n" + svgHtml, css: f.css + "\n" + css }
        : f
    );
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
    setActiveTool("select");
  }, [selectedFrameId, frames, autoSave]);

  // ── Phase F: Pathfinder boolean operations ──
  // Real boolean geometry computed locally from the frame's html/css via
  // pathBoolean (polygon-clipping). No server roundtrip: the MCP pathfinder
  // read the DB template (stale by up to 2s of debounced save) and treated
  // the SVG viewBox origin as the shape's position, so every op teleported
  // shapes to the top-left and "union" was just two paths in one svg.
  const handlePathfinder = useCallback((rawOp: PathfinderOp | "union" | "subtract") => {
    if (!selectedFrameId || multiSelectLayerIds.length < 2) return;
    const frame = framesRef.current.find(f => f.id === selectedFrameId);
    if (!frame) return;
    // Nombres heredados de los atajos (u/s/i/e) mapeados a la API de 10 ops.
    const op: PathfinderOp = rawOp === "union" ? "unite" : rawOp === "subtract" ? "minusFront" : rawOp;
    try {
      const doc = new DOMParser().parseFromString(frame.html || "", "text/html");
      const shapes: { id: string; ring: [number, number][]; fill: string; node: Element }[] = [];
      for (const layerId of multiSelectLayerIds) {
        const node = doc.querySelector(`[data-layer-id="${layerId}"]`);
        if (!node) continue;
        const geometry = extractShapeRing(node, frame.css || "");
        if (!geometry) {
          addToast("Buscatrazos: solo figuras con relleno — no textos, grupos ni imágenes.", "error");
          return;
        }
        shapes.push({ id: layerId, ...geometry, node });
      }
      if (shapes.length < 2) {
        addToast("Buscatrazos: no encontré las figuras seleccionadas.", "error");
        return;
      }

      // La pila va de ATRÁS hacia ADELANTE (orden de pintura del HTML):
      // minusFront/divide/trim/merge dependen de ese orden (convención Illustrator).
      const frameHtml = frame.html || "";
      const ordered = [...shapes].sort((a, b) =>
        frameHtml.indexOf(`data-layer-id="${a.id}"`) - frameHtml.indexOf(`data-layer-id="${b.id}"`));

      const result = pathfinder(op, ordered.map(s => ({ rings: [s.ring], fill: s.fill })));
      if (!result || result.shapes.length === 0) {
        addToast(`Buscatrazos: ${op} no produce ninguna figura (¿las formas se tocan?).`, "error");
        return;
      }

      const allRings = result.shapes.flatMap(face => face.rings);
      const bounds = ringsBounds(allRings);
      if (!bounds) return;
      const [minX, minY, maxX, maxY] = bounds;
      const width = Math.max(1, Math.round((maxX - minX) * 100) / 100);
      const height = Math.max(1, Math.round((maxY - minY) * 100) / 100);
      const localize = (rings: [number, number][][]) => rings.map(ring => ring.map(([x, y]) => [
        Math.round((x - minX) * 100) / 100,
        Math.round((y - minY) * 100) / 100,
      ] as [number, number]));

      // Un svg con un path por cara mantiene el undo atómico (REQ-043 Fase 3).
      const paths = result.shapes.map(face => {
        const d = ringsToPathD(localize(face.rings));
        if (!d) return "";
        return face.fill && face.fill !== "none"
          ? `<path d="${d}" fill="${face.fill}" fill-rule="evenodd"/>`
          : `<path d="${d}" fill="none" stroke="#c8b898" stroke-width="1"/>`;
      }).join("");

      const newLayerId = createLayerId();
      const opName = op.charAt(0).toUpperCase() + op.slice(1);
      const newHtml = `<svg data-layer-id="${newLayerId}" data-layer-name="${opName}" data-layer-kind="svg" viewBox="0 0 ${width} ${height}" style="position:absolute;left:${minX}px;top:${minY}px;width:${width}px;height:${height}px;overflow:visible;">${paths}</svg>`;

      for (const shape of shapes) shape.node.remove();
      const updatedFrameHtml = doc.body.innerHTML + "\n" + newHtml;
      const updatedFrameCss = removeLayersCss(frame.css || "", shapes.map(s => s.id))
        + `\n[data-layer-id="${newLayerId}"] {\n  position: absolute;\n  left: ${minX}px;\n  top: ${minY}px;\n  width: ${width}px;\n  height: ${height}px;\n  overflow: visible;\n}\n`;

      const updated = framesRef.current.map(f =>
        f.id === selectedFrameId ? { ...f, html: updatedFrameHtml, css: updatedFrameCss } : f
      );
      store.replaceAllWithUndo(updated, "edit");
      autoSave(updated);
      setMultiSelectLayerIds([]);
      handleSelectLayerElement(selectedFrameId, newLayerId);
      addToast(rawOp === "subtract"
        ? `Sustraer: resta a la PRIMERA figura seleccionada. ${shapes.length} figuras combinadas en una.`
        : `${opName}: ${shapes.length} figuras → ${result.shapes.length} ${result.shapes.length === 1 ? "figura" : "caras"}.`, "success");
    } catch (err: any) {
      addToast(`Buscatrazos falló: ${err?.message || "error desconocido"}`, "error");
      setMultiSelectLayerIds([]);
    }
  }, [selectedFrameId, multiSelectLayerIds, autoSave, addToast, handleSelectLayerElement]);

  // ── Phase G: SVG Import ──
  const handleSvgImported = useCallback(async (newTemplateId: string) => {
    setShowSvgImport(false);
    onBack();
  }, [onBack]);

  const handleRasterImageImported = useCallback(async (image: RasterImageImport) => {
    const frame = frames.find(item => item.id === selectedFrameId);

    // Upload to Supabase Storage instead of embedding base64 in HTML.
    // This keeps the JSONB template row small and prevents 502 timeouts.
    let imgSrc = image.dataUrl;
    try {
      const uploadRes = await apiFetch<{ url: string; assetId: string }>('/api/assets/upload', {
        method: 'POST',
        body: JSON.stringify({
          name: image.name,
          data: image.dataUrl,
          workspaceId: templateWorkspaceId,
        }),
      });
      if (uploadRes?.url) {
        imgSrc = uploadRes.url;
      }
    } catch {
      addToast("No se pudo subir a Storage — usando imagen temporal.", "error");
    }

    const layerId = createLayerId();
    const imageElement = document.createElement("img");
    imageElement.setAttribute("data-layer-id", layerId);
    imageElement.setAttribute("data-layer-name", image.name);
    imageElement.setAttribute("data-layer-kind", "image");
    imageElement.setAttribute("alt", image.name);
    imageElement.setAttribute("src", imgSrc);
    imageElement.setAttribute("draggable", "false");

    const sourceWidth = Math.max(1, image.width || 512);
    const sourceHeight = Math.max(1, image.height || 512);
    if (!frame) {
      const scale = Math.min(1, 800 / sourceWidth, 800 / sourceHeight);
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));
      const position = findCanvasObjectPosition(frames, canvasObjectsRef.current);
      const imageCss = `[data-layer-id="${layerId}"] {
  position: absolute;
  left: 0;
  top: 0;
  width: ${width}px;
  height: ${height}px;
  display: block;
  object-fit: contain;
}`;
      const object: HtmlCanvasObject = {
        id: layerId,
        name: image.name,
        kind: "image",
        frameId: null,
        html: imageElement.outerHTML,
        css: imageCss,
        ...position,
        width,
        height,
        zIndex: frames.length + canvasObjectsRef.current.length,
      };
      commitCanvasObjects([...canvasObjectsRef.current, object]);
      handleSelectOrphan(object.id);
      setShowSvgImport(false);
      addToast("Imagen insertada en el canvas.", "success");
      return;
    }

    const inserted = insertLayerIntoHtml(frame.html, imageElement.outerHTML, null, "inside");
    if (!inserted) {
      addToast("No se pudo insertar la imagen en el frame.", "error");
      return;
    }

    const availableWidth = Math.max(1, frame.width - 80);
    const availableHeight = Math.max(1, frame.height - 80);
    const scale = Math.min(1, availableWidth / sourceWidth, availableHeight / sourceHeight);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const left = Math.round((frame.width - width) / 2);
    const top = Math.round((frame.height - height) / 2);
    const imageCss = `[data-layer-id="${layerId}"] {
  position: absolute;
  left: ${left}px;
  top: ${top}px;
  width: ${width}px;
  height: ${height}px;
  display: block;
  object-fit: contain;
}`;
    const updated = frames.map(item => item.id === frame.id
      ? { ...item, html: inserted.html, css: mergeCssRules(item.css, imageCss) }
      : item);

    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
    handleSelectLayerElement(frame.id, layerId);
    addToast("Imagen insertada en el frame.", "success");
  }, [frames, selectedFrameId, autoSave, handleSelectLayerElement, handleSelectOrphan, addToast, templateWorkspaceId, commitCanvasObjects]);

  const handleAssetUploaded = useCallback(async (asset: { name: string; url: string; width?: number; height?: number }) => {
    let sourceWidth = asset.width || 512;
    let sourceHeight = asset.height || 512;
    if (!asset.width || !asset.height) {
      const dimensions = await new Promise<{ width: number; height: number } | null>((resolve) => {
        const probe = new Image();
        probe.onload = () => resolve({ width: probe.naturalWidth, height: probe.naturalHeight });
        probe.onerror = () => resolve(null);
        probe.src = asset.url;
      });
      if (dimensions) {
        sourceWidth = dimensions.width;
        sourceHeight = dimensions.height;
      }
    }
    const scale = Math.min(1, 800 / sourceWidth, 800 / sourceHeight);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const position = findCanvasObjectPosition(frames, canvasObjectsRef.current);
    const layerId = createLayerId();
    const imageElement = document.createElement("img");
    imageElement.setAttribute("data-layer-id", layerId);
    imageElement.setAttribute("data-layer-name", asset.name);
    imageElement.setAttribute("data-layer-kind", "image");
    imageElement.setAttribute("src", asset.url);
    imageElement.setAttribute("alt", asset.name);
    imageElement.setAttribute("draggable", "false");
    const html = imageElement.outerHTML;
    const css = `[data-layer-id="${layerId}"] {
  position: absolute;
  left: 0;
  top: 0;
  width: ${width}px;
  height: ${height}px;
  display: block;
  object-fit: contain;
}`;
    const object: HtmlCanvasObject = {
      id: layerId,
      name: asset.name,
      kind: "image",
      frameId: null,
      html,
      css,
      ...position,
      width,
      height,
      zIndex: frames.length + canvasObjectsRef.current.length,
    };
    commitCanvasObjects([...canvasObjectsRef.current, object]);
    handleSelectOrphan(object.id);
    addToast("Imagen añadida al canvas.", "success");
  }, [frames, commitCanvasObjects, handleSelectOrphan, addToast]);

  // ── Phase C: Delete element inside frame ──
  const handleDeleteElement = useCallback((layerId: string, frameId = selectedFrameId) => {
    if (!frameId) return;
    const frame = frames.find(f => f.id === frameId);
    if (!frame) return;
    const newHtml = deleteLayerFromHtml(frame.html, layerId);
    if (newHtml === null) return;
    const newCss = removeLayerCss(frame.css, layerId);
    const updated = frames.map(f =>
      f.id === frameId ? { ...f, html: newHtml, css: newCss } : f
    );
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
    setSelectedElement(null);
    setCrossFrameTargets(current => current.filter(t => !(t.layerId === layerId && (frameId === null || t.frameId === frameId))));
  }, [selectedFrameId, frames, autoSave]);

  // ── Phase C: Duplicate element inside frame ──
  const handleDuplicateElement = useCallback((layerId: string, frameId = selectedFrameId) => {
    if (!frameId) return;
    const frame = frames.find(f => f.id === frameId);
    if (!frame) return;
    const duplicated = duplicateLayerInHtml(frame.html, layerId, createLayerId);
    if (!duplicated) return;
    const newCss = cloneLayerCss(frame.css, duplicated.idMap, 20);
    const updated = frames.map(f =>
      f.id === frameId
        ? { ...f, html: duplicated.html, css: newCss }
        : f
    );
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
  }, [selectedFrameId, frames, autoSave]);

  // ── REQ-044 atajos de bloqueo/visibilidad (Ctrl+2/3, Ctrl+Alt+2/3) y
  // Alt+flecha = duplicar y mover el clon. Definidos ANTES del efecto de
  // teclado para poder entrar en su lista de deps.
  const handleLockSelectedShortcut = useCallback(() => {
    const fid = selectedElement?.frameId || contentFrameId || selectedFrameId;
    const lid = selectedElement?.layerId;
    if (!fid || !lid) return;
    const frame = frames.find(f => f.id === fid);
    if (!frame) return;
    const selector = `[data-layer-id="${lid}"]`;
    const isLocked = (getCssPropertyValue(frame.css, selector, "pointer-events") || "").includes("none");
    const updated = isLocked
      ? removeCssOverride(frame.css, selector, "pointer-events", "none !important")
      : appendCssOverride(frame.css, selector, "pointer-events", "none !important");
    handleFrameCssChange(fid, updated);
    addToast(isLocked ? "Capa desbloqueada." : "Capa bloqueada.", "info");
  }, [selectedElement, contentFrameId, selectedFrameId, frames, handleFrameCssChange, addToast]);

  const handleHideSelectedShortcut = useCallback(() => {
    const fid = selectedElement?.frameId || contentFrameId || selectedFrameId;
    const lid = selectedElement?.layerId;
    if (!fid || !lid) return;
    const frame = frames.find(f => f.id === fid);
    if (!frame) return;
    const selector = `[data-layer-id="${lid}"]`;
    const isHidden = (getCssPropertyValue(frame.css, selector, "display") || "").includes("none");
    const updated = isHidden
      ? removeCssOverride(frame.css, selector, "display", "none !important")
      : appendCssOverride(frame.css, selector, "display", "none !important");
    handleFrameCssChange(fid, updated);
    addToast(isHidden ? "Capa visible." : "Capa oculta.", "info");
  }, [selectedElement, contentFrameId, selectedFrameId, frames, handleFrameCssChange, addToast]);

  const handleUnlockAllLayers = useCallback(() => {
    const fid = contentFrameId || selectedFrameId;
    const frame = frames.find(f => f.id === fid);
    if (!fid || !frame) return;
    let css = frame.css;
    let touched = false;
    for (const m of frame.html.matchAll(/data-layer-id="([^"]+)"/g)) {
      if (m[1].startsWith("auto_")) continue;
      const cleared = removeCssOverride(css, `[data-layer-id="${m[1]}"]`, "pointer-events", "none !important");
      if (cleared !== css) { css = cleared; touched = true; }
    }
    if (!touched) { addToast("No hay capas bloqueadas.", "info"); return; }
    handleFrameCssChange(fid, css);
    addToast("Todas las capas desbloqueadas.", "success");
  }, [contentFrameId, selectedFrameId, frames, handleFrameCssChange, addToast]);

  const handleShowAllLayers = useCallback(() => {
    const fid = contentFrameId || selectedFrameId;
    const frame = frames.find(f => f.id === fid);
    if (!fid || !frame) return;
    let css = frame.css;
    let touched = false;
    for (const m of frame.html.matchAll(/data-layer-id="([^"]+)"/g)) {
      if (m[1].startsWith("auto_")) continue;
      const cleared = removeCssOverride(css, `[data-layer-id="${m[1]}"]`, "display", "none !important");
      if (cleared !== css) { css = cleared; touched = true; }
    }
    if (!touched) { addToast("No hay capas ocultas.", "info"); return; }
    handleFrameCssChange(fid, css);
    addToast("Todas las capas visibles.", "success");
  }, [contentFrameId, selectedFrameId, frames, handleFrameCssChange, addToast]);

  /** Alt+flecha: duplica la selección y mueve el clon en UN solo undo. */
  const handleDuplicateNudgeSelection = useCallback((deltaX: number, deltaY: number) => {
    const info = selectedElement;
    if (!info || info.movableLayers.length === 0) return;
    const frame = frames.find(f => f.id === info.frameId);
    if (!frame) return;
    let html = frame.html;
    let css = frame.css;
    for (const layer of info.movableLayers) {
      const duplicated = duplicateLayerInHtml(html, layer.layerId, createLayerId);
      if (!duplicated) continue;
      const newId = duplicated.idMap.get(layer.layerId);
      if (!newId) continue;
      html = duplicated.html;
      css = cloneLayerCss(css, duplicated.idMap, 20);
      const selector = `[data-layer-id="${newId}"]`;
      const currentLeft = getCssPropertyValue(css, selector, "left") || layer.left;
      const currentTop = getCssPropertyValue(css, selector, "top") || layer.top;
      const hasPixelPosition = /^-?\d+(?:\.\d+)?px/.test(currentLeft)
        || /^-?\d+(?:\.\d+)?px/.test(currentTop);
      if (layer.position === "static" || !hasPixelPosition) {
        const translate = parseTranslate(getCssPropertyValue(css, selector, "translate") || layer.translate);
        css = updateCssProperty(
          css,
          selector,
          "translate",
          `${translate.x + deltaX}px ${translate.y + deltaY}px !important`,
        );
        if (layer.display === "inline") {
          css = updateCssProperty(css, selector, "display", "inline-block !important");
        }
      } else {
        css = updateCssProperty(css, selector, "left", `${(parseFloat(currentLeft) || 0) + deltaX}px !important`);
        css = updateCssProperty(css, selector, "top", `${(parseFloat(currentTop) || 0) + deltaY}px !important`);
      }
    }
    if (html === frame.html) return;
    const updated = frames.map(f => f.id === info.frameId ? { ...f, html, css } : f);
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
  }, [selectedElement, frames, store, autoSave]);

  // ── REQ039 P2.5: per-letter separation with an editable original ──
  const handleSeparateText = useCallback((frameId: string, layerId: string, mode: "separate" | "restore") => {
    const frame = frames.find(f => f.id === frameId);
    if (!frame) return;
    if (mode === "restore") {
      const restored = restoreSeparatedText(frame.html, layerId);
      if (!restored) return;
      const updated = frames.map(f => (f.id === frameId ? { ...f, html: restored } : f));
      store.replaceAllWithUndo(updated, "edit");
      autoSave(updated);
      addToast("Letras unidas — el texto original vuelve a ser el único objeto", "success");
      return;
    }
    const source = extractLayerFromHtml(frame.html, layerId);
    if (!source || !layerIsSeparable(frame.html, layerId)) {
      addToast("Solo textos simples posicionados (un bloque de texto, sin hijos) se pueden separar", "error");
      return;
    }
    const boxes = measureLetterBoxes(source.layerHtml, extractLayerCssBlocks(frame.css, layerId));
    if (!boxes || boxes.length === 0) {
      addToast("No se pudo medir el texto — intenta de nuevo", "error");
      return;
    }
    const separated = separateTextLayer(frame.html, layerId, boxes, createLayerId);
    if (!separated || separated.letterIds.length === 0) return;
    const updated = frames.map(f => (f.id === frameId ? { ...f, html: separated.html } : f));
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
    addToast(`${separated.letterIds.length} letras creadas — son objetos independientes: editar el original no las actualiza (restáuralas y vuelve a separar)`, "info");
  }, [frames, autoSave, addToast]);

  // ── Change semantic tag of selected element ──
  const captureSelection = useCallback((): DesignClipboard | null => {
    if (selectedElement && selectedElement.frameId === selectedFrameId) {
      const sourceFrame = frames.find(frame => frame.id === selectedElement.frameId);
      if (!sourceFrame) return null;
      const sourceLayer = extractLayerFromHtml(sourceFrame.html, selectedElement.layerId);
      const translate = parseTranslate(selectedElement.computedStyles.translate);
      const localX = parseFloat(selectedElement.computedStyles.left) || 0;
      const localY = parseFloat(selectedElement.computedStyles.top) || 0;
      const bounds = selectedElement.visualBounds;
      const contentWidth = parseFloat(selectedElement.computedStyles.width) || bounds?.width || sourceFrame.width;
      const contentHeight = parseFloat(selectedElement.computedStyles.height) || bounds?.height || sourceFrame.height;
      const width = bounds?.width || contentWidth;
      const height = bounds?.height || contentHeight;
      const logicalX = localX + translate.x;
      const logicalY = localY + translate.y;
      const frameLocalX = bounds?.x ?? logicalX;
      const frameLocalY = bounds?.y ?? logicalY;
      return {
        kind: "element",
        frameId: sourceFrame.id,
        layerId: selectedElement.layerId,
        html: sourceFrame.html,
        css: sourceFrame.css,
        layout: {
          left: selectedElement.computedStyles.left,
          top: selectedElement.computedStyles.top,
          translate: selectedElement.computedStyles.translate,
        },
        canvasGeometry: {
          x: sourceFrame.x + frameLocalX,
          y: sourceFrame.y + frameLocalY,
          width,
          height,
          frameLocalX,
          frameLocalY,
          contentWidth,
          contentHeight,
          contentOffsetX: frameLocalX - logicalX,
          contentOffsetY: frameLocalY - logicalY,
          name: sourceLayer
            ? /data-layer-name=["']([^"']+)["']/i.exec(sourceLayer.layerHtml)?.[1] || selectedElement.tag
            : selectedElement.tag,
          kind: selectedElement.layerKind || (selectedElement.isSvg ? "shape" : selectedElement.tag === "img" ? "image" : "object"),
        },
        pasteCount: 0,
      };
    }

    if (selectedOrphanIds.size > 0) {
      const objects = canvasObjectsRef.current
        .filter(object => selectedOrphanIds.has(object.id))
        .map(object => ({ layerId: object.id, object: { ...object } }));
      if (objects.length > 0) return { kind: "canvas-object", objects, pasteCount: 0 };
    }

    const frameIds = selectedFrameIds.size > 0
      ? selectedFrameIds
      : new Set(selectedFrameId ? [selectedFrameId] : []);
    const copiedFrames = frames.filter(frame => frameIds.has(frame.id)).map(frame => ({ ...frame }));
    return copiedFrames.length > 0
      ? { kind: "frames", frames: copiedFrames, pasteCount: 0 }
      : null;
  }, [selectedElement, selectedFrameId, selectedFrameIds, selectedOrphanIds, frames]);

  const copySelection = useCallback(() => {
    const clipboard = captureSelection();
    if (!clipboard) return;
    const availableAcrossProjects = persistDesignClipboard(clipboard);
    if (clipboard.kind === "element") {
      addToast(availableAcrossProjects
        ? "Elemento copiado. Puedes pegarlo en otro proyecto."
        : "Elemento copiado en esta pestaña; es demasiado grande para compartirlo entre pestañas.",
      availableAcrossProjects ? "success" : "error");
      return;
    }
    if (clipboard.kind === "canvas-object") {
      const count = clipboard.objects.length;
      addToast(availableAcrossProjects
        ? `${count} objeto${count === 1 ? "" : "s"} copiado${count === 1 ? "" : "s"}. Puedes pegarlo en otro proyecto.`
        : `${count} objeto${count === 1 ? "" : "s"} copiado${count === 1 ? "" : "s"} en esta pestaña.`,
      availableAcrossProjects ? "success" : "error");
      return;
    }
    const copiedFrames = clipboard.frames;
    const message = `${copiedFrames.length} frame${copiedFrames.length === 1 ? "" : "s"} copiado${copiedFrames.length === 1 ? "" : "s"}`;
    addToast(availableAcrossProjects
      ? `${message}. Puedes pegarlo en otro proyecto.`
      : `${message} en esta pestaña; es demasiado grande para compartirlo entre pestañas.`,
    availableAcrossProjects ? "success" : "error");
  }, [captureSelection, addToast]);

  const cutSelection = useCallback(() => {
    const clipboard = captureSelection();
    if (!clipboard) return;

    if (clipboard.kind === "element") {
      persistDesignClipboard(clipboard);
      handleDeleteElement(clipboard.layerId, clipboard.frameId);
      addToast("Elemento cortado.", "success");
      return;
    }

    if (clipboard.kind === "canvas-object") {
      const ids = new Set(clipboard.objects.map(item => item.object.id));
      persistDesignClipboard(clipboard);
      commitCanvasObjects(canvasObjectsRef.current.filter(object => !ids.has(object.id)));
      setSelectedOrphanIds(new Set());
      addToast(`${ids.size} objeto${ids.size === 1 ? "" : "s"} cortado${ids.size === 1 ? "" : "s"}.`, "success");
      return;
    }

    const frameIds = new Set(clipboard.frames.map(frame => frame.id));
    if (!deleteFrames(frameIds)) {
      addToast("No se pudo cortar la selección.", "error");
      return;
    }
    persistDesignClipboard(clipboard);
    addToast(`${clipboard.frames.length} frame${clipboard.frames.length === 1 ? "" : "s"} cortado${clipboard.frames.length === 1 ? "" : "s"}.`, "success");
  }, [captureSelection, handleDeleteElement, deleteFrames, commitCanvasObjects, addToast]);

  const pasteSelection = useCallback(() => {
    const clipboard = readDesignClipboard();
    if (!clipboard) {
      addToast("No hay ningún elemento o frame copiado.", "error");
      return;
    }
    clipboard.pasteCount++;
    persistDesignClipboard(clipboard);
    // First paste lands at the EXACT copied position; the +20px cascade only
    // applies when the same clipboard is pasted again (avoids stacking copies
    // on top of each other without shifting cross-frame pastes).
    const offset = (clipboard.pasteCount - 1) * 20;

    if (clipboard.kind === "canvas-object") {
      const targetFrame = selectedFrameId ? frames.find(frame => frame.id === selectedFrameId) : null;
      if (targetFrame) {
        let nextHtml = targetFrame.html;
        let nextCss = targetFrame.css;
        let pastedCount = 0;
        const originX = Math.min(...clipboard.objects.map(item => item.object.x));
        const originY = Math.min(...clipboard.objects.map(item => item.object.y));
        for (const item of clipboard.objects) {
          const sourceLayer = extractLayerFromHtml(item.object.html, item.layerId);
          if (!sourceLayer) continue;
          const pasted = pasteLayerFromHtml(nextHtml, item.object.html, item.layerId, createLayerId, offset);
          if (!pasted) continue;
          nextHtml = pasted.html;
          let objectCss = cloneLayerTreeCss(
            item.object.css,
            sourceLayer.layerHtml,
            sourceLayer.layerIds,
            pasted.idMap,
            0,
            pasted.referenceIdMap,
          );
          const rootSelector = `[data-layer-id="${pasted.rootLayerId}"]`;
          const localX = item.object.x - originX + offset;
          const localY = item.object.y - originY + offset;
          const sourceSelector = `[data-layer-id="${item.layerId}"]`;
          const sourceLeft = parseFloat(getCssPropertyValue(item.object.css, sourceSelector, "left")) || 0;
          const sourceTop = parseFloat(getCssPropertyValue(item.object.css, sourceSelector, "top")) || 0;
          const sourceWidth = parseFloat(getCssPropertyValue(item.object.css, sourceSelector, "width")) || item.object.width;
          const sourceHeight = parseFloat(getCssPropertyValue(item.object.css, sourceSelector, "height")) || item.object.height;
          objectCss = updateCssProperty(objectCss, rootSelector, "position", "absolute");
          objectCss = updateCssProperty(objectCss, rootSelector, "left", `${localX + sourceLeft}px !important`);
          objectCss = updateCssProperty(objectCss, rootSelector, "top", `${localY + sourceTop}px !important`);
          objectCss = updateCssProperty(objectCss, rootSelector, "width", `${sourceWidth}px !important`);
          objectCss = updateCssProperty(objectCss, rootSelector, "height", `${sourceHeight}px !important`);
          nextCss = mergeCssRules(nextCss, objectCss);
          pastedCount++;
        }
        if (pastedCount === 0) return;
        const updated = frames.map(frame => frame.id === targetFrame.id
          ? { ...frame, html: nextHtml, css: nextCss }
          : frame);
        store.replaceAllWithUndo(updated, "paste");
        setContentFrameId(targetFrame.id);
        setSelectedFrameId(targetFrame.id);
        setSelectedFrameIds(new Set([targetFrame.id]));
        setSelectedOrphanIds(new Set());
        setSelectedElement(null);
        autoSave(updated);
        addToast(`${pastedCount} objeto${pastedCount === 1 ? "" : "s"} pegado${pastedCount === 1 ? "" : "s"} dentro del frame.`, "success");
        return;
      }

      const clones: HtmlCanvasObject[] = [];
      for (const item of clipboard.objects) {
        const sourceLayer = extractLayerFromHtml(item.object.html, item.layerId);
        const pasted = pasteLayerFromHtml("", item.object.html, item.layerId, createLayerId, 0);
        if (!sourceLayer || !pasted) continue;
        const rootSelector = `[data-layer-id="${pasted.rootLayerId}"]`;
        let css = cloneLayerTreeCss(
          item.object.css,
          sourceLayer.layerHtml,
          sourceLayer.layerIds,
          pasted.idMap,
          0,
          pasted.referenceIdMap,
        );
        css = updateCssProperty(css, rootSelector, "position", "absolute");
        const sourceSelector = `[data-layer-id="${item.layerId}"]`;
        css = updateCssProperty(css, rootSelector, "left", getCssPropertyValue(item.object.css, sourceSelector, "left") || "0px !important");
        css = updateCssProperty(css, rootSelector, "top", getCssPropertyValue(item.object.css, sourceSelector, "top") || "0px !important");
        css = updateCssProperty(css, rootSelector, "width", getCssPropertyValue(item.object.css, sourceSelector, "width") || `${item.object.width}px !important`);
        css = updateCssProperty(css, rootSelector, "height", getCssPropertyValue(item.object.css, sourceSelector, "height") || `${item.object.height}px !important`);
        clones.push({
          ...item.object,
          id: pasted.rootLayerId,
          frameId: null,
          html: pasted.html,
          css,
          x: item.object.x + offset,
          y: item.object.y + offset,
          zIndex: frames.length + canvasObjectsRef.current.length + clones.length,
        });
      }
      if (clones.length === 0) return;
      commitCanvasObjects([...canvasObjectsRef.current, ...clones]);
      setSelectedOrphanIds(new Set(clones.map(object => object.id)));
      setSelectedFrameId(null);
      setSelectedFrameIds(new Set());
      setContentFrameId(null);
      setSelectedElement(null);
      addToast(`${clones.length} objeto${clones.length === 1 ? "" : "s"} pegado${clones.length === 1 ? "" : "s"} en el canvas.`, "success");
      return;
    }

    if (clipboard.kind === "element") {
      const sourceLayer = extractLayerFromHtml(clipboard.html, clipboard.layerId);
      if (!sourceLayer) return;
      const targetFrame = selectedFrameId ? frames.find(frame => frame.id === selectedFrameId) : null;
      if (!targetFrame) {
        const pasted = pasteLayerFromHtml("", clipboard.html, clipboard.layerId, createLayerId, 0);
        if (!pasted) return;
        const geometry = clipboard.canvasGeometry;
        const fallback = findCanvasObjectPosition(frames, canvasObjectsRef.current);
        const width = Math.max(8, Math.round(geometry?.width || parseFloat(getCssPropertyValue(clipboard.css, `[data-layer-id="${clipboard.layerId}"]`, "width")) || 100));
        const height = Math.max(8, Math.round(geometry?.height || parseFloat(getCssPropertyValue(clipboard.css, `[data-layer-id="${clipboard.layerId}"]`, "height")) || 100));
        const contentWidth = Math.max(1, geometry?.contentWidth || width);
        const contentHeight = Math.max(1, geometry?.contentHeight || height);
        const rootSelector = `[data-layer-id="${pasted.rootLayerId}"]`;
        let css = cloneLayerTreeCss(
          clipboard.css,
          sourceLayer.layerHtml,
          sourceLayer.layerIds,
          pasted.idMap,
          0,
          pasted.referenceIdMap,
        );
        css = updateCssProperty(css, rootSelector, "position", "absolute");
        css = updateCssProperty(css, rootSelector, "left", `${-(geometry?.contentOffsetX || 0)}px !important`);
        css = updateCssProperty(css, rootSelector, "top", `${-(geometry?.contentOffsetY || 0)}px !important`);
        css = updateCssProperty(css, rootSelector, "translate", "none !important");
        css = updateCssProperty(css, rootSelector, "width", `${contentWidth}px !important`);
        css = updateCssProperty(css, rootSelector, "height", `${contentHeight}px !important`);
        const object: HtmlCanvasObject = {
          id: pasted.rootLayerId,
          name: geometry?.name || /data-layer-name=["']([^"']+)["']/i.exec(sourceLayer.layerHtml)?.[1] || "Object",
          kind: geometry?.kind || /data-layer-kind=["']([^"']+)["']/i.exec(sourceLayer.layerHtml)?.[1] || "object",
          frameId: null,
          html: pasted.html,
          css,
          x: Math.round((geometry?.x ?? fallback.x) + offset),
          y: Math.round((geometry?.y ?? fallback.y) + offset),
          width,
          height,
          zIndex: frames.length + canvasObjectsRef.current.length,
        };
        commitCanvasObjects([...canvasObjectsRef.current, object]);
        setSelectedOrphanIds(new Set([object.id]));
        setSelectedFrameId(null);
        setSelectedFrameIds(new Set());
        setContentFrameId(null);
        setSelectedElement(null);
        addToast("Elemento pegado en el canvas.", "success");
        return;
      }
      const targetFrameId = targetFrame.id;
      const pasted = pasteLayerFromHtml(
        targetFrame.html,
        clipboard.html,
        clipboard.layerId,
        createLayerId,
        offset,
      );
      if (!pasted) return;
      let pastedCss = cloneLayerTreeCss(
        clipboard.css,
        sourceLayer.layerHtml,
        sourceLayer.layerIds,
        pasted.idMap,
        0,
        pasted.referenceIdMap,
      );
      const rootSelector = `[data-layer-id="${pasted.rootLayerId}"]`;
      pastedCss = updateCssProperty(pastedCss, rootSelector, "position", "absolute");
      if (clipboard.canvasGeometry) {
        const geometry = clipboard.canvasGeometry;
        pastedCss = updateCssProperty(pastedCss, rootSelector, "left", `${(geometry.frameLocalX || 0) - (geometry.contentOffsetX || 0) + offset}px !important`);
        pastedCss = updateCssProperty(pastedCss, rootSelector, "top", `${(geometry.frameLocalY || 0) - (geometry.contentOffsetY || 0) + offset}px !important`);
        pastedCss = updateCssProperty(pastedCss, rootSelector, "translate", "none !important");
        pastedCss = updateCssProperty(pastedCss, rootSelector, "width", `${geometry.contentWidth || geometry.width}px !important`);
        pastedCss = updateCssProperty(pastedCss, rootSelector, "height", `${geometry.contentHeight || geometry.height}px !important`);
      } else {
        const translate = parseTranslate(clipboard.layout.translate);
        const left = parseFloat(clipboard.layout.left) || 0;
        const top = parseFloat(clipboard.layout.top) || 0;
        pastedCss = updateCssProperty(pastedCss, rootSelector, "left", `${left + translate.x + offset}px !important`);
        pastedCss = updateCssProperty(pastedCss, rootSelector, "top", `${top + translate.y + offset}px !important`);
        pastedCss = updateCssProperty(pastedCss, rootSelector, "translate", "none !important");
      }
      const newCss = mergeCssRules(targetFrame.css, pastedCss);
      const updated = frames.map(frame => frame.id === targetFrameId
        ? { ...frame, html: pasted.html, css: newCss }
        : frame);
      store.replaceAllWithUndo(updated, "edit");
      setSelectedFrameId(targetFrameId);
      setSelectedFrameIds(new Set([targetFrameId]));
      setContentFrameId(targetFrameId);
      setSelectedElement(null);
      setActiveTool("select");
      autoSave(updated);
      addToast("Elemento pegado.", "success");
      return;
    }

    let frameNumber = nextFrameNumber(frames);
    const clones = clipboard.frames.map(source => cloneFrame(
      source,
      source.x + offset,
      source.y + offset,
      `Frame ${frameNumber++}`,
    ));
        const updated = [...frames, ...clones];
    store.replaceAllWithUndo(updated, "edit");
    setSelectedFrameId(clones[0].id);
    setSelectedFrameIds(new Set(clones.map(frame => frame.id)));
    setContentFrameId(null);
    setSelectedElement(null);
    autoSave(updated);
    addToast(`${clones.length} frame${clones.length === 1 ? "" : "s"} pegado${clones.length === 1 ? "" : "s"}.`, "success");
  }, [selectedFrameId, frames, autoSave, commitCanvasObjects, addToast]);

  const handleChangeTag = useCallback((newTag: string) => {
    if (!selectedElement || !selectedFrameId) return;
    const frame = frames.find(f => f.id === selectedElement.frameId);
    if (!frame) return;

    const layerId = selectedElement.layerId;
    const newHtml = changeLayerTag(frame.html, layerId, newTag);
    if (newHtml === null) return;

    const updated = frames.map(f =>
      f.id === selectedElement.frameId ? { ...f, html: newHtml } : f
    );
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
    setSelectedElement(prev => prev ? { ...prev, tag: newTag } : null);
  }, [selectedElement, selectedFrameId, frames, autoSave]);

  // ── F3: remove-background — swap an <img> src to its cutout, non-destructively ──
  const handleImageSrcChange = useCallback((frameId: string, layerId: string, newSrc: string, origSrc: string | null) => {
    const frame = frames.find(f => f.id === frameId);
    if (!frame) return;

    const attrs: Record<string, string> = { src: newSrc };
    if (origSrc && origSrc !== newSrc) attrs["data-orig-src"] = origSrc;
    const newHtml = setLayerAttributes(frame.html, layerId, attrs);
    if (newHtml === null) return;

    const updated = frames.map(f => (f.id === frameId ? { ...f, html: newHtml } : f));
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
    setSelectedElement(prev => (prev && prev.frameId === frameId && prev.layerId === layerId ? { ...prev, src: newSrc } : prev));
  }, [frames, autoSave]);

  const handleImageRestore = useCallback((frameId: string, layerId: string) => {
    const frame = frames.find(f => f.id === frameId);
    if (!frame) return;

    const orig = getLayerAttribute(frame.html, layerId, "data-orig-src");
    if (!orig) return;
    let newHtml = setLayerAttributes(frame.html, layerId, { src: orig });
    if (newHtml === null) return;
    newHtml = removeLayerAttribute(newHtml, layerId, "data-orig-src");
    if (newHtml === null) return;

    const updated = frames.map(f => (f.id === frameId ? { ...f, html: newHtml } : f));
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
    setSelectedElement(prev => (prev && prev.frameId === frameId && prev.layerId === layerId ? { ...prev, src: orig } : prev));
  }, [frames, autoSave]);

  // ── Modo Foto (REQ-PHOTO-PLATFORM-001): salida del overlay → diseño.
  // La variante es una rendition NUEVA; el original vive una sola vez en
  // data-orig-src (nunca se reescribe) y la receta viaja embebida en la
  // capa (data-photo-recipe, base64url) para reanudar el revelado.
  const handlePhotoApplyToLayer = useCallback((target: PhotoTarget, variantUrl: string, recipeAttr: string) => {
    // Frame rasterizado: la "capa" no existe en el html — la variante entra
    // como <img> NUEVA encima (append = tope del z-order por orden de DOM).
    // Las capas originales quedan intactas debajo; data-orig-src apunta al
    // raster del frame para que restaurar vuelva a la copia pixel sin editar.
    if (target.kind === "frameRaster" && target.frameId) {
      const frame = frames.find(f => f.id === target.frameId);
      if (!frame) return;
      const layerId = createLayerId();
      const imgHtml = `<img data-layer-id="${layerId}" data-layer-name="Frame pixel — ${(frame.name || "frame").replace(/"/g, "&quot;")}" src="${variantUrl}" data-orig-src="${target.src}" data-photo-recipe="${recipeAttr}" style="position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;" />`;
      const inserted = insertLayerIntoHtml(frame.html, imgHtml, null, "inside");
      if (!inserted) return;
      const updated = frames.map(f => (f.id === target.frameId ? { ...f, html: inserted.html } : f));
      store.replaceAllWithUndo(updated, "edit");
      autoSave(updated);
      setPhotoModeOpen(false);
      return;
    }
    const attrsFor = (html: string): Record<string, string> => ({
      src: variantUrl,
      "data-photo-recipe": recipeAttr,
      // inmutabilidad (REQ §2): data-orig-src se escribe UNA vez, jamás se pisa
      "data-orig-src": getLayerAttribute(html, target.layerId, "data-orig-src") || target.src,
    });
    if (target.frameId) {
      const frame = frames.find(f => f.id === target.frameId);
      if (!frame) return;
      const newHtml = setLayerAttributes(frame.html, target.layerId, attrsFor(frame.html));
      if (newHtml === null) return;
      const updated = frames.map(f => (f.id === target.frameId ? { ...f, html: newHtml } : f));
      store.replaceAllWithUndo(updated, "edit");
      autoSave(updated);
      setSelectedElement(prev => (prev && prev.frameId === target.frameId && prev.layerId === target.layerId ? { ...prev, src: variantUrl } : prev));
    } else {
      const obj = canvasObjects.find(o => o.id === target.layerId);
      if (!obj) return;
      const newHtml = setLayerAttributes(obj.html, target.layerId, attrsFor(obj.html));
      if (newHtml === null) return;
      commitCanvasObjects(canvasObjects.map(o => (o.id === obj.id ? { ...o, html: newHtml } : o)));
    }
    // §5: aplicar ES una acción de salida — de vuelta al diseño con la variante.
    setPhotoModeOpen(false);
  }, [frames, canvasObjects, store, autoSave, commitCanvasObjects]);

  // §2: todas las instancias de la MISMA foto (mismo src) en un solo lote —
  // la confirmación explícita vive en el overlay (window.confirm).
  const handlePhotoApplyToAllInstances = useCallback((src: string, variantUrl: string, recipeAttr: string) => {
    const applyToHtml = (html: string): string | null => {
      let out = html;
      for (const t of parseFrameImages("", html)) {
        if (t.src !== src) continue;
        const next = setLayerAttributes(out, t.layerId, {
          src: variantUrl,
          "data-photo-recipe": recipeAttr,
          "data-orig-src": getLayerAttribute(out, t.layerId, "data-orig-src") || t.src,
        });
        if (next === null) continue;
        out = next;
      }
      return out === html ? null : out;
    };
    const updated = frames.map(f => {
      const html = applyToHtml(f.html || "");
      return html === null ? f : { ...f, html };
    });
    const nextObjects = canvasObjects.map(o => {
      if (o.kind !== "image") return o;
      const html = applyToHtml(o.html || "");
      return html === null ? o : { ...o, html };
    });
    const framesChanged = updated.some((f, i) => f !== frames[i]);
    const objectsChanged = nextObjects.some((o, i) => o !== canvasObjects[i]);
    if (framesChanged) {
      store.replaceAllWithUndo(updated, "edit");
      autoSave(updated);
    }
    if (objectsChanged) commitCanvasObjects(nextObjects);
    if (framesChanged || objectsChanged) setPhotoModeOpen(false);
  }, [frames, canvasObjects, store, autoSave, commitCanvasObjects]);

  // Entrada al Modo Foto: resuelve el target activo (el <img> del elemento
  // seleccionado o el huérfano image). Sin selección explícita NO se abre:
  // caer a la primera foto del diseño edita un archivo que nadie eligió.
  const handleOpenPhotoMode = useCallback(() => {
    const el = selectedElement;
    if (el && el.tag === "img" && el.src) {
      const frame = frames.find(f => f.id === el.frameId);
      setPhotoModeTarget({
        frameId: el.frameId,
        layerId: el.layerId,
        src: el.src,
        name: (frame && getLayerAttribute(frame.html, el.layerId, "data-layer-name")) || "Foto",
        recipeAttr: frame ? getLayerAttribute(frame.html, el.layerId, "data-photo-recipe") : null,
      });
      setPhotoModeOpen(true);
      return;
    }
    const orphan = canvasObjects.find(o => selectedOrphanIds.has(o.id) && o.kind === "image");
    if (orphan) {
      const img = parseFrameImages(orphan.id, orphan.html || "")[0];
      if (img) {
        setPhotoModeTarget({ ...img, frameId: null, name: orphan.name || img.name });
        setPhotoModeOpen(true);
        return;
      }
    }
    // M-27: sin selección no hay target seguro — pedir una en vez de editar
    // en silencio la primera foto del diseño.
    addToast("Seleccioná una imagen para entrar al Modo Foto.", "error");
  }, [selectedElement, frames, canvasObjects, selectedOrphanIds, addToast]);

  // Un único selector mantiene los tres editores mutuamente excluyentes.
  // Diseño sólo cierra los overlays; Video y Foto siguen usando sus flujos
  // existentes y por eso preservan guardado en Supabase y deep links.
  const handleSelectEditor = useCallback((editor: "design" | "video" | "photo") => {
    setShowEditorMenu(false);
    if (editor === "design") {
      setVideoModeOpen(false);
      setPhotoModeOpen(false);
      return;
    }
    if (editor === "video") {
      setPhotoModeOpen(false);
      setVideoModeOpen(true);
      return;
    }
    setVideoModeOpen(false);
    // El menú abre el picker de origen (frames rasterizables + atajo a la foto
    // seleccionada); el flujo clásico sigue vivo vía "Editar foto" del panel.
    setPhotoFramePickerOpen(true);
  }, []);

  // ── Convert element to SVG path ──
  const handleConvertToPath = useCallback(async (layerId: string, frameId: string) => {
    if (!templateId) return;
    try {
      const result = await mcpCall("shape_to_path", { templateId, frameId, elementId: layerId });
      if (result?.success) {
        // Reload template to get updated frames
        const tpl = await getTemplate(templateId);
        if (tpl && tpl.frames) {

          store.replaceAll(tpl.frames as FrameData[]);
          autoSave(tpl.frames);
        }
      }
    } catch (err) {
      console.error("[ConvertToPath] Error:", err);
    }
  }, [templateId, frames, autoSave]);

  // ── REQ-043: Object → Path — local engines ──
  // The same pure modules the MCP tool imports run right here: no server
  // roundtrip (the MCP path read the DB template, stale by up to 2s of
  // debounced save), undo-tracked and autosaved like any other edit.
  const commitLayerPathD = useCallback((frameId: string, layerId: string, nextD: string, message: string, extraAttrs?: Record<string, string>) => {
    const frame = framesRef.current.find(f => f.id === frameId);
    if (!frame) return false;
    const analysis = analyzePathData(nextD);
    let html = replaceLayerPathData(frame.html, layerId, nextD, {
      "data-bezier-model": "chained-cubic",
      "data-bezier-degeneracy": analysis.degeneracy,
      "data-bezier-self-intersections": String(analysis.selfIntersections),
      "data-bezier-singularities": String(analysis.singularities),
      ...extraAttrs,
    });
    if (html === null) return false;
    if (extraAttrs) {
      // Attribute-only follow-ups (Outline Stroke's fill swap) chain on the
      // rewritten markup; a null just means the layer vanished mid-edit.
      html = setLayerAttributes(html, layerId, extraAttrs) ?? html;
    }
    if (html === frame.html) return false;
    // A path that masks an image re-bakes the mask's CSS so the clip follows.
    const reBaked = reBakePathMask(html, frame.css, layerId);
    const updated = framesRef.current.map(f => f.id === frameId
      ? { ...f, html: reBaked?.html ?? html, css: reBaked?.css ?? f.css }
      : f);
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
    addToast(message, "success");
    return true;
  }, [autoSave, addToast, store]);

  const getLayerPathD = useCallback((frameId: string, layerId: string): string | null => {
    const frame = framesRef.current.find(f => f.id === frameId);
    if (!frame) return null;
    return getLayerAttribute(frame.html, layerId, "d");
  }, []);

  // ── Outline stroke: convert stroke to filled outline path ──
  const handleOutlineStroke = useCallback((layerId: string, frameId: string) => {
    const frame = framesRef.current.find(f => f.id === frameId);
    const d = getLayerPathD(frameId, layerId);
    if (!frame || !d) { addToast("Outline Stroke: selecciona un trazado.", "error"); return; }
    const sw = parseFloat(getLayerAttribute(frame.html, layerId, "stroke-width") || "") || 2;
    const cap = (getLayerAttribute(frame.html, layerId, "stroke-linecap") as StrokeOpts["cap"]) || "round";
    const join = (getLayerAttribute(frame.html, layerId, "stroke-linejoin") as StrokeOpts["join"]) || "round";
    const outlined = outlineStrokeD(d, sw, { cap, join });
    if (!outlined) { addToast("Outline Stroke: no se pudo calcular el contorno del trazo.", "error"); return; }
    // Illustrator semantics: the outline inherits the stroke colour and the
    // stroke itself goes away.
    const strokeColor = getLayerAttribute(frame.html, layerId, "stroke") || "#8B5CF6";
    commitLayerPathD(frameId, layerId, outlined, "Contorno de trazo aplicado.", {
      fill: strokeColor,
      stroke: "none",
      "stroke-width": "0",
    });
  }, [getLayerPathD, commitLayerPathD, addToast]);

  // ── Offset path: inset/outset by distance ──
  const handleOffsetPath = useCallback((layerId: string, frameId: string, offset: number) => {
    const d = getLayerPathD(frameId, layerId);
    if (!d) { addToast("Offset: selecciona un trazado.", "error"); return; }
    const offsetD = offsetPathD(d, offset, { join: "round" });
    if (!offsetD) {
      addToast(offset < 0
        ? "Offset: el trazado es abierto (o el inset vacía la figura)."
        : "Offset: no se pudo calcular el desplazamiento.", "error");
      return;
    }
    commitLayerPathD(frameId, layerId, offsetD, `Trazado desplazado ${offset > 0 ? "+" : ""}${offset}px.`);
  }, [getLayerPathD, commitLayerPathD, addToast]);

  // ── REQ-045: diálogo numérico de transformación (Enter con select/hand) ──
  const [numericTransform, setNumericTransform] = useState<{
    frameId: string;
    layerId: string;
    initial: NumericTransformValues;
  } | null>(null);

  // ── REQ-045: compound paths — componer (Ctrl+8) / liberar (Ctrl+Alt+8) ──
  // El compound vive a nivel de string d (varios M...Z en UNA capa); el
  // navegador rellena los anillos con fill-rule evenodd. v1: los trazados
  // deben compartir espacio (pluma/línea anclan su viewBox al frame).
  const handleCompoundPath = useCallback((mode: "make" | "release") => {
    const fid = selectedElement?.frameId || contentFrameId || selectedFrameId;
    if (!fid) { addToast("Compuesto: no hay frame activo.", "error"); return; }
    const frame = framesRef.current.find(f => f.id === fid);
    if (!frame) return;
    if (mode === "make") {
      const ids = multiSelectLayerIds.length >= 2 ? multiSelectLayerIds : [];
      if (ids.length < 2) { addToast("Compuesto: selecciona al menos 2 trazados.", "error"); return; }
      const baseHtml = frame.html || "";
      const ds = ids.map(id => getLayerPathD(fid, id));
      if (ds.some(d => !d)) { addToast("Solo capas SVG por ahora.", "error"); return; }
      const merged = makeCompoundD(ds as string[]);
      if (!merged) { addToast("Compuesto: se necesitan al menos 2 subtrazados.", "error"); return; }
      // La capa más alta (última en DOM) conserva el compound y su pintura;
      // las demás se eliminan en el MISMO documento para un undo atómico.
      const ordered = [...ids].sort((a, b) =>
        baseHtml.indexOf(`data-layer-id="${a}"`) - baseHtml.indexOf(`data-layer-id="${b}"`));
      const targetId = ordered[ordered.length - 1];
      const analysis = analyzePathData(merged);
      let html = replaceLayerPathData(baseHtml, targetId, merged, {
        "data-bezier-model": "chained-cubic",
        "data-bezier-degeneracy": analysis.degeneracy,
        "data-bezier-self-intersections": String(analysis.selfIntersections),
        "data-bezier-singularities": String(analysis.singularities),
      });
      if (html === null) { addToast("Compuesto: no se pudo reescribir el trazado.", "error"); return; }
      const removed: string[] = [];
      for (const id of ordered) {
        if (id === targetId) continue;
        html = deleteLayerFromHtml(html, id) ?? html;
        removed.push(id);
      }
      if (html === baseHtml) { addToast("Compuesto: no cambió nada.", "info"); return; }
      const css = removeLayersCss(frame.css || "", removed);
      const updated = framesRef.current.map(f => f.id === fid ? { ...f, html, css } : f);
      store.replaceAllWithUndo(updated, "edit");
      autoSave(updated);
      addToast("Trazado compuesto creado.", "success");
      return;
    }
    // release: 1 capa multi-M → N capas en su mismo lugar z; cada clon
    // hereda pintura (atributos viajan con el nodo; CSS de pluma se duplica).
    const lid = selectedElement?.layerId || multiSelectLayerIds[0];
    if (!lid) { addToast("Liberar: selecciona un trazado compuesto.", "error"); return; }
    const d = getLayerPathD(fid, lid);
    if (!d) { addToast("Solo capas SVG por ahora.", "error"); return; }
    const parts = releaseCompoundD(d);
    if (!parts) { addToast("Liberar: el trazado no es compuesto (1 subtrazado).", "info"); return; }
    const doc = new DOMParser().parseFromString(frame.html || "", "text/html");
    const layer = [...doc.querySelectorAll("[data-layer-id]")].find(el => el.getAttribute("data-layer-id") === lid);
    if (!layer) return;
    const layerPath = layer.matches("path") ? layer : layer.querySelector("path");
    if (!layerPath) { addToast("Solo capas SVG por ahora.", "error"); return; }
    layerPath.setAttribute("d", parts[0]);
    let cssExtra = "";
    let anchor: Element = layer;
    for (let i = 1; i < parts.length; i++) {
      const clone = layer.cloneNode(true) as Element;
      const newId = createLayerId();
      clone.setAttribute("data-layer-id", newId);
      const clonePath = clone.matches("path") ? clone : clone.querySelector("path");
      if (clonePath) clonePath.setAttribute("d", parts[i]);
      anchor.after(clone);
      anchor = clone;
      cssExtra += cloneLayerCssBlocks(frame.css || "", lid, newId);
    }
    const html = doc.body.innerHTML;
    if (html === frame.html) return;
    const css = (frame.css || "") + cssExtra;
    const updated = framesRef.current.map(f => f.id === fid ? { ...f, html, css } : f);
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
    addToast(`Trazado compuesto liberado en ${parts.length} capas.`, "success");
  }, [selectedElement, contentFrameId, selectedFrameId, multiSelectLayerIds, getLayerPathD, addToast, autoSave, store]);

  // ── REQ-045: paint keys — X intercambia, D default, , frontal, . sin fill ──
  // Operan sobre el HTML del frame vía layerPaint (undo atómico); una capa
  // sin target SVG (div/texto) se omite y se avisa.
  const applyPaintKey = useCallback((key: "swap" | "default" | "fill" | "none") => {
    const fid = selectedElement?.frameId || contentFrameId || selectedFrameId;
    if (!fid) return;
    const frame = framesRef.current.find(f => f.id === fid);
    if (!frame) return;
    const ids = multiSelectLayerIds.length > 0 ? multiSelectLayerIds : (selectedElement ? [selectedElement.layerId] : []);
    if (ids.length === 0) { addToast("Selecciona una capa para pintar.", "info"); return; }
    let html = frame.html || "";
    let painted = 0;
    let skipped = 0;
    for (const id of ids) {
      const next = key === "swap" ? swapLayerPaintHtml(html, id)
        : key === "default" ? resetLayerPaintHtml(html, id)
        : key === "fill" ? writeLayerFillHtml(html, id, foregroundColor)
        : writeLayerFillHtml(html, id, "none");
      if (next === null) { skipped++; continue; }
      html = next;
      painted++;
    }
    if (painted === 0) { addToast("Solo capas SVG por ahora.", "error"); return; }
    const updated = framesRef.current.map(f => f.id === fid ? { ...f, html } : f);
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
    const messages: Record<string, string> = {
      swap: "Pintura intercambiada (X).",
      default: "Pintura por defecto: relleno blanco, trazo negro (D).",
      fill: "Rellenado con el color frontal (,).",
      none: "Relleno quitado (.).",
    };
    addToast(messages[key] + (skipped > 0 ? ` (${skipped} capa(s) no SVG omitida(s))` : ""), "success");
  }, [selectedElement, contentFrameId, selectedFrameId, multiSelectLayerIds, foregroundColor, addToast, autoSave, store]);

  // ── REQ-045: distorsión de trazado (panel Distorsión → motor puro) ──
  const handleDistortPath = useCallback((effect: DistortEffect, opts: ApplyDistortOptions = {}) => {
    const fid = selectedElement?.frameId || contentFrameId;
    const lid = selectedElement?.layerId;
    if (!fid || !lid) { addToast("Distorsión: selecciona una capa de trazado.", "error"); return; }
    const d = getLayerPathD(fid, lid);
    if (!d) { addToast("Distorsión: la capa no tiene trazado editable.", "error"); return; }
    const points = parsePathData(d);
    const closed = /z\s*$/i.test(d.trim());
    const distorted = applyDistortion(points, closed, effect, opts);
    if (!distorted) { addToast("Distorsión: el resultado degeneró y se canceló.", "error"); return; }
    commitLayerPathD(fid, lid, serializePathData(distorted, closed), "Distorsión aplicada.");
  }, [selectedElement, contentFrameId, getLayerPathD, commitLayerPathD, addToast]);

  // ── REQ-045: blend de exactamente 2 trazados — inserta N pasos intermedios ──
  const handleBlendLayers = useCallback((steps: number, flipB = false) => {
    const fid = selectedElement?.frameId || contentFrameId;
    if (!fid) { addToast("Mezclar: no hay frame activo.", "error"); return; }
    const frame = framesRef.current.find(f => f.id === fid);
    if (!frame) return;
    if (multiSelectLayerIds.length !== 2) { addToast("Mezclar: selecciona exactamente 2 trazados.", "error"); return; }
    const [idA, idB] = multiSelectLayerIds;
    const dA = getLayerPathD(fid, idA);
    const dB = getLayerPathD(fid, idB);
    if (!dA || !dB) { addToast("Mezclar: las capas deben ser SVG con trazado.", "error"); return; }
    const stepDs = blendD(dA, dB, steps, { flipB });
    if (!stepDs || stepDs.length === 0) { addToast("Mezclar: pasos fuera de rango (1-50) o trazados degenerados.", "error"); return; }
    // Cada paso clona la capa superior (hereda pintura/posición) con su d.
    const doc = new DOMParser().parseFromString(frame.html || "", "text/html");
    const layerB = [...doc.querySelectorAll("[data-layer-id]")].find(el => el.getAttribute("data-layer-id") === idB);
    const layerBPath = layerB ? (layerB.matches("path") ? layerB : layerB.querySelector("path")) : null;
    if (!layerB || !layerBPath) { addToast("Mezclar: la capa superior no es un trazado SVG.", "error"); return; }
    let anchor: Element = layerB;
    const newIds: string[] = [];
    for (const stepD of stepDs) {
      const clone = layerB.cloneNode(true) as Element;
      const newId = createLayerId();
      clone.setAttribute("data-layer-id", newId);
      clone.setAttribute("data-layer-name", `Mezcla ${newIds.length + 1}`);
      const clonePath = clone.matches("path") ? clone : clone.querySelector("path");
      if (clonePath) clonePath.setAttribute("d", stepD);
      anchor.after(clone);
      anchor = clone;
      newIds.push(newId);
    }
    const html = doc.body.innerHTML;
    if (html === frame.html) return;
    let css = frame.css || "";
    for (const nid of newIds) css += cloneLayerCssBlocks(css, idB, nid);
    const updated = framesRef.current.map(f => f.id === fid ? { ...f, html, css } : f);
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
    addToast(`Mezcla creada: ${stepDs.length} paso(s) intermedio(s).`, "success");
  }, [selectedElement, contentFrameId, multiSelectLayerIds, getLayerPathD, addToast, autoSave, store]);

  // ── REQ-045: aplicar el diálogo numérico — inline style + regla CSS ──
  const handleNumericTransformApply = useCallback((values: NumericTransformValues) => {
    if (!numericTransform) return;
    const { frameId, layerId } = numericTransform;
    const frame = framesRef.current.find(f => f.id === frameId);
    if (!frame) return;
    const doc = new DOMParser().parseFromString(frame.html || "", "text/html");
    const layer = [...doc.querySelectorAll("[data-layer-id]")].find(el => el.getAttribute("data-layer-id") === layerId);
    if (!layer) { setNumericTransform(null); return; }
    // Inline style (fuente inmediata) + regla CSS (el selection box y los
    // resizes leen de la regla) — las mismas claves que el rotate UI.
    const decls: Record<string, string> = {};
    (layer.getAttribute("style") || "").split(";").forEach(statement => {
      const i = statement.indexOf(":");
      if (i > 0) decls[statement.slice(0, i).trim().toLowerCase()] = statement.slice(i + 1).trim();
    });
    decls.left = `${values.x}px`;
    decls.top = `${values.y}px`;
    decls.width = `${values.width}px`;
    decls.height = `${values.height}px`;
    const baseTransform = decls.transform && decls.transform !== "none" ? decls.transform : "";
    const nextTransform = values.rotate
      ? setTransformFunction(baseTransform, "rotate", `${values.rotate}deg`)
      : removeTransformFunction(baseTransform, "rotate");
    if (nextTransform && nextTransform !== "none") decls.transform = nextTransform;
    else delete decls.transform;
    layer.setAttribute("style", Object.entries(decls).map(([k, v]) => `${k}:${v}`).join(";"));
    const html = doc.body.innerHTML;
    if (html === frame.html) { setNumericTransform(null); return; }
    let css = frame.css || "";
    const selector = `[data-layer-id="${layerId}"]`;
    css = updateCssProperty(css, selector, "left", `${values.x}px`) ?? css;
    css = updateCssProperty(css, selector, "top", `${values.y}px`) ?? css;
    css = updateCssProperty(css, selector, "width", `${values.width}px`) ?? css;
    css = updateCssProperty(css, selector, "height", `${values.height}px`) ?? css;
    css = updateCssProperty(css, selector, "transform", nextTransform || "none") ?? css;
    const updated = framesRef.current.map(f => f.id === frameId ? { ...f, html, css } : f);
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
    setNumericTransform(null);
    addToast(`Transformado: X ${values.x}, Y ${values.y}, ${values.width}×${values.height}${values.rotate ? `, ${values.rotate}°` : ""}.`, "success");
  }, [numericTransform, addToast, autoSave, store]);

  // ── Object → Path commands (Simplify/Smooth/Add/Remove/Join/Reverse/Average/Cleanup) ──
  const handleObjectPathOp = useCallback((op: "simplify" | "smooth" | "addAnchors" | "removeRedundant" | "join" | "reverse" | "average" | "cleanup", layerId: string, frameId: string, axis: "h" | "v" | "both" = "both") => {
    if (op === "join") {
      // With ≥2 path layers selected, Join merges them into the topmost one
      // (Illustrator semantics); a single open path closes through its ends.
      const joinIds = multiSelectLayerIds.length >= 2
        ? multiSelectLayerIds
        : [layerId];
      const frame = framesRef.current.find(f => f.id === frameId);
      if (!frame) return;
      const parsed = joinIds.map(id => {
        const d = getLayerPathD(frameId, id);
        if (!d) return null;
        try {
          return { id, d, points: parsePathData(d), closed: /z\s*$/i.test(d.trim()) };
        } catch { return null; }
      }).filter((x): x is { id: string; d: string; points: ReturnType<typeof parsePathData>; closed: boolean } => Boolean(x));
      if (parsed.length === 0) { addToast("Unir: selecciona uno o más trazados.", "error"); return; }
      const result = joinPaths(parsed.map(p => ({ points: p.points, closed: p.closed })), 5);
      if (result.length !== 1) { addToast("Unir: no se encontraron extremos dentro de la tolerancia.", "error"); return; }
      const mergedD = serializePathData(result[0].points, result[0].closed);
      // Keep the TOPMOST layer (last in the HTML), delete the rest.
      const ordered = [...parsed].sort((a, b) =>
        (frame.html || "").indexOf(`data-layer-id="${a.id}"`) - (frame.html || "").indexOf(`data-layer-id="${b.id}"`));
      const target = ordered[ordered.length - 1];
      if (!commitLayerPathD(frameId, target.id, mergedD, "Trazados unidos.")) return;
      if (ordered.length > 1) {
        let html = frame.html || "";
        let css = frame.css || "";
        for (const p of ordered) {
          if (p.id === target.id) continue;
          html = deleteLayerFromHtml(html, p.id) ?? html;
          css = removeLayersCss(css, [p.id]);
        }
        const updated = framesRef.current.map(f => f.id === frameId ? { ...f, html, css } : f);
        store.replaceAllWithUndo(updated, "edit");
        autoSave(updated);
      }
      return;
    }
    const d = getLayerPathD(frameId, layerId);
    if (!d) { addToast("Selecciona un trazado.", "error"); return; }
    let points: ReturnType<typeof parsePathData>;
    try { points = parsePathData(d); } catch { addToast("No se pudo leer el trazado.", "error"); return; }
    const closed = /z\s*$/i.test(d.trim());
    const stray = op === "cleanup" ? removeStrayAnchors(points, closed) : null;
    if (op === "cleanup" && !stray) { addToast("Limpieza: no hay anclas sueltas que quitar.", "info"); return; }
    let next: ReturnType<typeof parsePathData>;
    switch (op) {
      case "simplify": next = simplifyPath(points, closed, { tolerance: 1 }); break;
      case "smooth": next = smoothPath(points, closed, 1); break;
      case "addAnchors": next = addAnchorPoints(points, closed); break;
      case "removeRedundant": next = removeRedundantPoints(points, closed, 0.25); break;
      // REQ-044: Reverse / Average / Cleanup (paridad Object → Path).
      case "reverse": next = reversePath(points, closed); break;
      case "average": next = averagePath(points, axis); break;
      case "cleanup": next = stray!.points; break;
    }
    const messages: Record<string, string> = {
      simplify: "Trazado simplificado.",
      smooth: "Anclas suavizadas.",
      addAnchors: "Anclas añadidas en los puntos medios.",
      removeRedundant: "Anclas redundantes eliminadas.",
      reverse: "Trazado invertido.",
      average: `Anclas promediadas (${axis === "h" ? "horizontal" : axis === "v" ? "vertical" : "XY"}).`,
      cleanup: `Limpieza: ${stray!.removed} ${stray!.removed === 1 ? "ancla suelta eliminada" : "anclas sueltas eliminadas"}.`,
    };
    commitLayerPathD(frameId, layerId, serializePathData(next, closed), messages[op]);
  }, [multiSelectLayerIds, getLayerPathD, commitLayerPathD, addToast, autoSave, store]);


  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Shell-first boot: the document isn't in memory yet — every shortcut
      // (Ctrl+S version save, Delete, nudge, paste, …) would act on an
      // empty store.
      if (loadingRef.current) return;
      // Modo Video abierto: el timeline es el dueño del teclado (Space/
      // flechas/Delete/van al playhead y clips, no al canvas).
      if (videoModeOpenRef.current || photoModeOpenRef.current) return;
      // Escape closes dropdowns
      if (e.key === "Escape") {
        setShowFontPicker(false);
        return;
      }
      if (isEditingInShadowDOM(e)) return;
      // The floating chat panel lives outside the editor's own DOM tree, so
      // isEditableTarget (input/textarea/contenteditable only) doesn't catch
      // plain text selections inside its message bubbles — without this,
      // Ctrl+C in the chat was hijacked into "copy the selected frame".
      if ((e.target as HTMLElement)?.closest?.('[data-chat-fab-panel]')) return;
      const mod = e.metaKey || e.ctrlKey;
      // Ctrl/⌘+Alt combos: wrap in frame + boolean operations (Figma-style)
      if (mod && e.altKey) {
        switch (e.key.toLowerCase()) {
          case "g": e.preventDefault(); handleWrapSelectionInFrame(); return;
          case "u": e.preventDefault(); handlePathfinder("union"); return;
          case "s": e.preventDefault(); handlePathfinder("subtract"); return;
          case "i": e.preventDefault(); handlePathfinder("intersect"); return;
          case "e": e.preventDefault(); handlePathfinder("exclude"); return;
          // REQ-044: Ctrl+Alt+2 desbloquea TODAS las capas del frame activo,
          // Ctrl+Alt+3 las muestra todas (paridad Illustrator Object menu).
          case "2": e.preventDefault(); handleUnlockAllLayers(); return;
          case "3": e.preventDefault(); handleShowAllLayers(); return;
          // REQ-045: Ctrl+Alt+8 libera un trazado compuesto en N capas.
          case "8": e.preventDefault(); handleCompoundPath("release"); return;
        }
      }
      if (mod && e.key === "z" && !e.shiftKey) { e.preventDefault(); e.stopImmediatePropagation(); handleUndo(); return; }
      if (mod && (e.key === "Z" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); e.stopImmediatePropagation(); handleRedo(); return; }
      // Ctrl+S (Windows) / ⌘+S (Mac): save a permanent version instead of
      // letting the browser open its "save page" dialog.
      if (mod && e.key.toLowerCase() === "s" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        handleSaveVersion();
        return;
      }
      if (mod && e.key === "/") { e.preventDefault(); openCodeTab(); return; }
      if (mod && e.key.toLowerCase() === "b") {
        e.preventDefault();
        if (showRightPanel && rightPanelTab === "batch") {
          setShowRightPanel(false);
        } else {
          setBatchCheckedFrameIds(selectedFrameIds.size > 0 ? new Set(selectedFrameIds) : new Set(selectedFrameId ? [selectedFrameId] : []));
          setRightPanelTab("batch");
          setShowRightPanel(true);
        }
        return;
      }
      if (mod && e.key.toLowerCase() === "c" && !e.shiftKey) { e.preventDefault(); copySelection(); return; }
      if (mod && e.key.toLowerCase() === "x" && !e.shiftKey) { e.preventDefault(); cutSelection(); return; }
      if (mod && e.key.toLowerCase() === "v" && !e.shiftKey) { e.preventDefault(); pasteSelection(); return; }
      // REQ-027: Ctrl+D duplica lo SELECCIONADO — si hay elemento activo
      // duplica la capa (paridad Figma); el frame entero sólo cuando no
      // hay selección de elemento. Ctrl+Shift+D sigue siendo duplicar capa
      // explícito y no cambia.
      if (mod && e.key.toLowerCase() === "d" && !e.shiftKey) {
        e.preventDefault();
        if (selectedElement) handleDuplicateElement(selectedElement.layerId);
        else duplicateFrame();
        return;
      }
      if (mod && e.key.toLowerCase() === "g" && !e.shiftKey && !e.altKey) { e.preventDefault(); handleGroup(); return; }
      if (mod && e.shiftKey && e.key.toLowerCase() === "g") { e.preventDefault(); handleUngroup(); return; }
      if (mod && e.shiftKey && e.key.toLowerCase() === "d") { e.preventDefault(); if (selectedElement) handleDuplicateElement(selectedElement.layerId); return; }
      // REQ-044: Ctrl+J = Join sobre la capa seleccionada (con ≥2 capas el
      // op "join" ya itera multiSelectLayerIds internamente).
      if (mod && e.key.toLowerCase() === "j" && !e.shiftKey) {
        e.preventDefault();
        const jfid = selectedElement?.frameId || contentFrameId || selectedFrameId;
        const jlid = selectedElement?.layerId || multiSelectLayerIds[0];
        if (jfid && jlid) handleObjectPathOp("join", jlid, jfid);
        return;
      }
      // REQ-044: Ctrl+2 bloquea / Ctrl+3 oculta la capa seleccionada
      // (Ctrl+Alt+2/3 se resolvieron arriba: desbloquear/mostrar TODAS).
      if (mod && e.key === "2" && !e.altKey) { e.preventDefault(); handleLockSelectedShortcut(); return; }
      if (mod && e.key === "3" && !e.altKey) { e.preventDefault(); handleHideSelectedShortcut(); return; }
      // REQ-045: Ctrl+8 compone ≥2 trazados en un compound (1 capa multi-M).
      if (mod && e.key === "8" && !e.altKey) { e.preventDefault(); handleCompoundPath("make"); return; }
      // REQ-045: Enter con selección activa y tool select/hand abre el
      // diálogo numérico de transformación (caja viva vía frameBoundsRegistry).
      if (e.key === "Enter" && !mod && !e.altKey && !e.shiftKey
        && !isEditableTarget(e.target)
        && (activeTool === "select" || activeTool === "hand")
        && selectedElement?.frameId && selectedElement?.layerId) {
        const bounds = frameBoundsRegistry.get(selectedElement.frameId)?.(selectedElement.layerId);
        if (bounds) {
          e.preventDefault();
          setNumericTransform({ frameId: selectedElement.frameId, layerId: selectedElement.layerId, initial: bounds });
        }
      }
      if (mod && e.key === "3" && !e.altKey) { e.preventDefault(); handleHideSelectedShortcut(); return; }
      // Select all objects in the active frame
      if (mod && e.key.toLowerCase() === "a" && !e.shiftKey) {
        const fid = contentFrameId || selectedElement?.frameId || selectedFrameId || frames[0]?.id;
        if (fid) {
          e.preventDefault();
          frameMarqueeRegistry.get(fid)?.({ left: -1e9, top: -1e9, right: 1e9, bottom: 1e9 });
        }
        return;
      }
      // REQ-044: Ctrl+Shift+A = deselect total — un marquee con un rect que
      // no pega a nada recorre el camino existente de "0 hits" y limpia.
      if (mod && e.shiftKey && e.key.toLowerCase() === "a") {
        const fid = contentFrameId || selectedElement?.frameId || selectedFrameId || frames[0]?.id;
        if (fid) {
          e.preventDefault();
          frameMarqueeRegistry.get(fid)?.({ left: -10, top: -10, right: -5, bottom: -5 });
        }
        return;
      }
      // Zoom: Ctrl+= / Ctrl+- / Ctrl+0 (fit)
      if (mod && (e.key === "=" || e.key === "+")) { e.preventDefault(); handleZoomIn(); return; }
      if (mod && e.key === "-") { e.preventDefault(); handleZoomOut(); return; }
      if (mod && e.key === "0") { e.preventDefault(); handleZoomToFit(); return; }
      // Convención Figma: Shift+1 encuadra todo (Ctrl+0 sigue siendo el atajo
      // nativo; el dogfood BUG-16 mostró que Shift+1 se da por sentado).
      if (!mod && e.shiftKey && e.code === "Digit1") { e.preventDefault(); handleZoomToFit(); return; }
      // Reorder: Ctrl+] forward, Ctrl+[ backward (Shift = front/back)
      if (mod && e.key === "]") { e.preventDefault(); if (selectedElement) handleReorder(e.shiftKey ? "top" : "up"); return; }
      if (mod && e.key === "[") { e.preventDefault(); if (selectedElement) handleReorder(e.shiftKey ? "bottom" : "down"); return; }
      // Canvas guides: Ctrl+R = toggle rulers, Ctrl+' = toggle pixel grid, Ctrl+; = toggle column panel
      if (mod && e.key.toLowerCase() === "r" && !e.altKey && !e.shiftKey) { e.preventDefault(); setShowRulers(v => !v); return; }
      if (mod && e.key === "'") { e.preventDefault(); setShowGrid(v => !v); return; }
      if (mod && e.key === ";") { e.preventDefault(); setShowColumnPanel(v => !v); return; }
      if (!mod) {
        switch (e.key.toLowerCase()) {
          case "v": setActiveTool("select"); break;
          case "h": setActiveTool("hand"); break;
          case "f":
          case "a": setActiveTool("frame"); break;
          case "r": setActiveTool("rect"); break;
          case "o": setActiveTool("circle"); break;
          case "s": setActiveTool("star"); break;
          case "g": setActiveTool("triangle"); break;
          case "n": setActiveTool("polygon"); break;
          case "t":
            if (e.shiftKey) { setActiveTool("text-path"); }
            else { setActiveTool("text"); }
            break;
          case "p": setActiveTool("pen"); break;
          case "b": setActiveTool("pencil"); break;
          case "e": setActiveTool("eraser"); break;
          // F2 Varita: W toggles SAM click-to-segment (Esc/Enter live in DesignFrame).
          case "w": setActiveTool(t => t === "wand" ? "select" : "wand"); break;
          // F4: [ ] resize the eraser brush (only while the tool is active,
          // so reorder shortcuts Ctrl+[ / Ctrl+] keep their meaning).
          case "[":
            if (activeTool === "eraser") { e.preventDefault(); setBrushSize(s => Math.max(4, s - 4)); }
            break;
          case "]":
            if (activeTool === "eraser") { e.preventDefault(); setBrushSize(s => Math.min(200, s + 4)); }
            break;
          // REQ-045: paint keys (paridad Illustrator) con guardia de targets
          // editables — X intercambia fill/stroke, D default, , frontal,
          // . sin relleno. Multi-selección: cada capa SVG.
          case "x":
            if (!isEditableTarget(e.target)) { e.preventDefault(); applyPaintKey("swap"); }
            break;
          case "d":
            if (!isEditableTarget(e.target)) { e.preventDefault(); applyPaintKey("default"); }
            break;
          case ",":
            if (!isEditableTarget(e.target)) { e.preventDefault(); applyPaintKey("fill"); }
            break;
          case ".":
            if (!isEditableTarget(e.target)) { e.preventDefault(); applyPaintKey("none"); }
            break;
          case "i": setActiveTool(t => t === "eyedropper" ? "select" : "eyedropper"); break;
          // REQ-044: C = tijeras (Illustrator); ⇧C = editar pluma.
          case "c":
            if (e.shiftKey) setActiveTool("pen-edit");
            else setActiveTool("scissors");
            break;
          // REQ-044: Z = zoom in, ⇧Z = zoom out (Illustrator parity).
          case "z":
            if (e.shiftKey) handleZoomOut();
            else handleZoomIn();
            break;
          // REQ-044: \ = herramienta línea.
          case "\\":
            setActiveTool("line");
            break;
          case "delete":
          case "backspace":
            // A selected guide deletes first — read through the ref because
            // this shortcut effect is registered once, not per selection.
            if (selectedGuideIdRef.current) {
              const gid = selectedGuideIdRef.current;
              setGuides(gs => gs.filter(g => g.id !== gid));
              setSelectedGuideId(null);
              break;
            }
            if (selectedElement) {
              handleDeleteElement(selectedElement.layerId);
            } else if (selectedOrphanIds.size > 0) {
              for (const id of selectedOrphanIds) {
                handleDeleteOrphan(id);
              }
            } else if (selectedFrameId && frames.length > 1) {
              if (Date.now() - frameDeleteArmRef.current < 2500) {
                frameDeleteArmRef.current = 0;
                deleteSelectedFrame();
              } else {
                frameDeleteArmRef.current = Date.now();
                addToast("Eso borraría el FRAME completo: pulsa Delete otra vez para confirmar.", "info");
              }
            }
            break;
          case "arrowleft":
          case "arrowright":
          case "arrowup":
          case "arrowdown":
            if (selectedElement) {
              e.preventDefault();
              const step = e.shiftKey ? 10 : 1;
              let deltaX = 0;
              let deltaY = 0;
              if (e.key === "ArrowLeft") deltaX = -step;
              if (e.key === "ArrowRight") deltaX = step;
              if (e.key === "ArrowUp") deltaY = -step;
              if (e.key === "ArrowDown") deltaY = step;
              // REQ-044: Alt+flecha = duplicar y mover el clon en UN paso de
              // undo (Illustrator); flecha sola sigue moviendo el original.
              if (e.altKey) handleDuplicateNudgeSelection(deltaX, deltaY);
              else handleElementNudge(selectedElement, deltaX, deltaY);
            } else if (selectedFrameId && !contentFrameId) {
              e.preventDefault();
              const f = frames.find(fr => fr.id === selectedFrameId);
              if (f) {
                const step = e.shiftKey ? 10 : 1;
                let nx = f.x, ny = f.y;
                if (e.key === "ArrowLeft") nx -= step;
                if (e.key === "ArrowRight") nx += step;
                if (e.key === "ArrowUp") ny -= step;
                if (e.key === "ArrowDown") ny += step;
                handleFrameMove(f.id, nx, ny);
              }
            }
            break;
        }
      }
    };
    const handleNativeCopy = (e: ClipboardEvent) => {
      if (videoModeOpenRef.current || photoModeOpenRef.current) return;
      if (isEditableTarget(e.target)) return;
      if ((e.target as HTMLElement)?.closest?.('[data-chat-fab-panel]')) return;
      const hasSelection = Boolean(selectedElement && selectedElement.frameId === selectedFrameId)
        || selectedOrphanIds.size > 0
        || selectedFrameIds.size > 0
        || Boolean(selectedFrameId);
      if (!hasSelection) return;
      e.preventDefault();
      e.clipboardData?.setData("text/plain", "Futuraria design object");
      copySelection();
    };
    const handleNativePaste = (e: ClipboardEvent) => {
      if (videoModeOpenRef.current || photoModeOpenRef.current) return;
      if (isEditableTarget(e.target)) return;
      if ((e.target as HTMLElement)?.closest?.('[data-chat-fab-panel]')) return;
      if (readDesignClipboard()) {
        e.preventDefault();
        pasteSelection();
        return;
      }
      const text = e.clipboardData?.getData("text/plain") || "";
      if (!text.trim()) return;
      e.preventDefault();
      if (looksLikeRenderableCode(text) && !isPasteImagePromptSnoozed()) {
        setPasteChoiceText(text);
      } else {
        handlePasteTextAsBlock(text);
      }
    };
    const handleNativeCut = (e: ClipboardEvent) => {
      if (videoModeOpenRef.current || photoModeOpenRef.current) return;
      if (isEditableTarget(e.target)) return;
      if ((e.target as HTMLElement)?.closest?.('[data-chat-fab-panel]')) return;
      const hasSelection = Boolean(selectedElement && selectedElement.frameId === selectedFrameId)
        || selectedOrphanIds.size > 0
        || selectedFrameIds.size > 0
        || Boolean(selectedFrameId);
      if (!hasSelection) return;
      e.preventDefault();
      e.clipboardData?.setData("text/plain", "Futuraria design object");
      cutSelection();
    };
    window.addEventListener("keydown", handler, { capture: true });
    window.addEventListener("copy", handleNativeCopy, { capture: true });
    window.addEventListener("cut", handleNativeCut, { capture: true });
    window.addEventListener("paste", handleNativePaste, { capture: true });
    return () => {
      window.removeEventListener("keydown", handler, { capture: true });
      window.removeEventListener("copy", handleNativeCopy, { capture: true });
      window.removeEventListener("cut", handleNativeCut, { capture: true });
      window.removeEventListener("paste", handleNativePaste, { capture: true });
    };
  }, [handleUndo, handleRedo, copySelection, cutSelection, pasteSelection, deleteSelectedFrame, duplicateFrame, handleDeleteElement, handleDuplicateElement, handleElementNudge, handleDuplicateNudgeSelection, handleWrapSelectionInFrame, handlePathfinder, handleObjectPathOp, handleLockSelectedShortcut, handleHideSelectedShortcut, handleUnlockAllLayers, handleShowAllLayers, selectedElement, selectedFrameId, selectedFrameIds, selectedOrphanIds, frames.length, contentFrameId, handleFrameMove, frames, handleZoomIn, handleZoomOut, handleZoomToFit, handleSaveVersion, openCodeTab, looksLikeRenderableCode, isPasteImagePromptSnoozed, handlePasteTextAsBlock, showRightPanel, rightPanelTab, activeTool, multiSelectLayerIds, handleCompoundPath, applyPaintKey]);

  // ── Export ──
  /// Serialize a frame to SVG for vector export
  // ── Native SVG generation: walks DOM tree, resolves styles, emits <rect>/<text>/<image> ──
  // Unlike foreignObject SVG, this produces elements Figma and Illustrator can import.
  const buildFrameSvg = useCallback(async (frame: FrameData): Promise<string> => {
    const w = frame.width || 1080;
    const h = frame.height || 1080;
    const bg = frame.background || "#ffffff";
    const html = frame.html || "";
    const css = frame.css || "";

    const escXml = (t: string) => t.replace(/[<>&'"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);

    // Render into a hidden, real DOM (a shadow root, mirroring DesignFrame's
    // own #__df_content scoping) instead of reimplementing CSS by hand. The
    // previous version only ever read an element's OWN inline left/top as
    // an absolute offset — anything positioned by document flow, a parent's
    // padding, or a flex "Contenedor" layout (never an explicit left/top)
    // silently landed at (0,0), which is exactly the "image pinned to the
    // top-left, text missing" bug reported against real exports. Letting the
    // browser do the actual layout, then reading it back with
    // getBoundingClientRect/getComputedStyle, handles any layout mode
    // correctly and also gives exact CSS cascade resolution (any selector
    // shape) for free — no bespoke selector matcher needed.
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:-99999px;top:0;pointer-events:none;";
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const styleEl = document.createElement("style");
    styleEl.textContent = `#__df_content { width: ${w}px; height: ${h}px; overflow: hidden; }\n${mapBodySelectors(css)}`;
    shadow.appendChild(styleEl);
    const content = document.createElement("div");
    content.id = "__df_content";
    content.innerHTML = html;
    content.style.position = "relative";
    content.style.background = bg;
    shadow.appendChild(content);

    // Let images (already inlined as data: URIs by the caller) and web
    // fonts settle before measuring — an unloaded image or fallback font
    // metric would throw off the box sizes we're about to read.
    const imgs = Array.from(content.querySelectorAll("img"));
    await Promise.all(imgs.map(img => img.complete ? Promise.resolve() : new Promise<void>(resolve => {
      img.addEventListener("load", () => resolve(), { once: true });
      img.addEventListener("error", () => resolve(), { once: true });
      setTimeout(resolve, 2000);
    })));
    if (document.fonts?.ready) { try { await document.fonts.ready; } catch { /* fall back to default metrics */ } }

    const svgParts: string[] = [];

    // ── Filters: CSS `filter` has no direct SVG-attribute equivalent — each
    // function becomes an SVG filter primitive, chained in source order
    // (grayscale/saturate → feColorMatrix, contrast/brightness → a linear
    // feComponentTransfer, blur → feGaussianBlur). Needed because real
    // designs chain more than grayscale alone, e.g.
    // `grayscale(100%) contrast(220%) brightness(95%)` for a halftone photo
    // treatment — translating only the grayscale term left the exported
    // photo visibly flatter than the PNG/JPG export of the same frame.
    const filterDefs: string[] = [];
    const filterIdByKey = new Map<string, string>();
    const getOrCreateFilter = (primitives: string[]): string => {
      if (!primitives.length) return "";
      const key = primitives.join("|");
      let id = filterIdByKey.get(key);
      if (!id) {
        id = `f-${filterIdByKey.size}`;
        filterIdByKey.set(key, id);
        filterDefs.push(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">${primitives.join("")}</filter>`);
      }
      return id;
    };
    const buildFilterChain = (raw: string): string => {
      if (!raw || raw === "none") return "";
      const primitives: string[] = [];
      for (const fn of raw.matchAll(/([a-z-]+)\(([^)]*)\)/g)) {
        const name = fn[1];
        const arg = fn[2].trim();
        if (name === "grayscale" || name === "saturate") {
          let amt = parseFloat(arg) || 0;
          if (arg.includes("%")) amt /= 100;
          const values = name === "grayscale" ? (1 - Math.max(0, Math.min(1, amt))).toFixed(3) : amt.toFixed(3);
          primitives.push(`<feColorMatrix type="saturate" values="${values}"/>`);
        } else if (name === "contrast") {
          let c = parseFloat(arg) || 1;
          if (arg.includes("%")) c /= 100;
          const intercept = (0.5 * (1 - c)).toFixed(3);
          primitives.push(`<feComponentTransfer><feFuncR type="linear" slope="${c}" intercept="${intercept}"/><feFuncG type="linear" slope="${c}" intercept="${intercept}"/><feFuncB type="linear" slope="${c}" intercept="${intercept}"/></feComponentTransfer>`);
        } else if (name === "brightness") {
          let b = parseFloat(arg) || 1;
          if (arg.includes("%")) b /= 100;
          primitives.push(`<feComponentTransfer><feFuncR type="linear" slope="${b}"/><feFuncG type="linear" slope="${b}"/><feFuncB type="linear" slope="${b}"/></feComponentTransfer>`);
        } else if (name === "blur") {
          const px = parseFloat(arg) || 0;
          primitives.push(`<feGaussianBlur stdDeviation="${(px / 2).toFixed(2)}"/>`);
        }
      }
      const id = getOrCreateFilter(primitives);
      return id ? ` filter="url(#${id})"` : "";
    };

    // ── Gradients & masks: parse a computed `linear-gradient(...)` (found
    // anywhere inside a background-image/mask-image value — paren-depth
    // scan, not a naive regex, so nested rgba(...) stops don't break it)
    // into angle + color stops, shared by background fills and masks.
    const splitTopLevel = (str: string, sep: string): string[] => {
      const out: string[] = [];
      let depth = 0, cur = "";
      for (const ch of str) {
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        if (ch === sep && depth === 0) { out.push(cur); cur = ""; } else { cur += ch; }
      }
      if (cur) out.push(cur);
      return out;
    };
    const splitColorAlpha = (color: string): { color: string; alpha: number } => {
      const m = color.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)/);
      if (m) return { color: `rgb(${m[1]}, ${m[2]}, ${m[3]})`, alpha: m[4] !== undefined ? parseFloat(m[4]) : 1 };
      return { color, alpha: 1 };
    };
    const DIRECTION_ANGLES: Record<string, number> = {
      top: 0, bottom: 180, left: 270, right: 90,
      "top right": 45, "right top": 45, "bottom right": 135, "right bottom": 135,
      "bottom left": 225, "left bottom": 225, "top left": 315, "left top": 315,
    };
    const parseLinearGradient = (source: string): { angleDeg: number; stops: { color: string; pct: number }[] } | null => {
      const startIdx = source.indexOf("linear-gradient(");
      if (startIdx === -1) return null;
      let depth = 0, end = -1;
      for (let i = startIdx + "linear-gradient(".length - 1; i < source.length; i++) {
        if (source[i] === "(") depth++;
        else if (source[i] === ")") { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end === -1) return null;
      const parts = splitTopLevel(source.slice(startIdx + "linear-gradient(".length, end), ",").map(p => p.trim());
      if (!parts.length) return null;
      let angleDeg = 180; // CSS default direction is "to bottom"
      let stopParts = parts;
      const angleMatch = parts[0].match(/^(-?[\d.]+)deg$/);
      if (angleMatch) { angleDeg = parseFloat(angleMatch[1]); stopParts = parts.slice(1); }
      else if (/^to\s+/i.test(parts[0])) {
        const dir = parts[0].replace(/^to\s+/i, "").trim().toLowerCase();
        angleDeg = DIRECTION_ANGLES[dir] ?? 180;
        stopParts = parts.slice(1);
      }
      const stops = stopParts.map(p => {
        const colorMatch = p.match(/^(rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}|[a-zA-Z]+)/);
        const color = colorMatch ? colorMatch[0] : "#000000";
        const pctMatch = p.slice(color.length).trim().match(/(-?[\d.]+)%/);
        return { color, pct: pctMatch ? parseFloat(pctMatch[1]) : null };
      });
      if (stops.length) {
        if (stops[0].pct === null) stops[0].pct = 0;
        if (stops[stops.length - 1].pct === null) stops[stops.length - 1].pct = 100;
        for (let i = 1; i < stops.length - 1; i++) {
          if (stops[i].pct === null) {
            let j = i; while (j < stops.length && stops[j].pct === null) j++;
            const startPct = stops[i - 1].pct as number, endPct = stops[j].pct as number, span = j - i + 1;
            for (let k = i; k < j; k++) stops[k].pct = startPct + (endPct - startPct) * (k - i + 1) / span;
          }
        }
      }
      return { angleDeg, stops: stops as { color: string; pct: number }[] };
    };
    const angleToCoords = (deg: number) => {
      const rad = (deg * Math.PI) / 180;
      const dx = Math.sin(rad), dy = -Math.cos(rad);
      return { x1: (0.5 - dx / 2).toFixed(4), y1: (0.5 - dy / 2).toFixed(4), x2: (0.5 + dx / 2).toFixed(4), y2: (0.5 + dy / 2).toFixed(4) };
    };
    const gradDefs: string[] = [];
    const gradIdByKey = new Map<string, string>();
    const getOrCreateGradient = (parsed: { angleDeg: number; stops: { color: string; pct: number }[] }): string => {
      const key = JSON.stringify(parsed);
      let id = gradIdByKey.get(key);
      if (!id) {
        id = `grad-${gradIdByKey.size}`;
        gradIdByKey.set(key, id);
        const { x1, y1, x2, y2 } = angleToCoords(parsed.angleDeg);
        const stops = parsed.stops.map(s => {
          const { color, alpha } = splitColorAlpha(s.color);
          return `<stop offset="${s.pct}%" stop-color="${escXml(color)}" stop-opacity="${alpha}"/>`;
        }).join("");
        gradDefs.push(`<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops}</linearGradient>`);
      }
      return id;
    };
    const resolveBackgroundFill = (cs: CSSStyleDeclaration): { type: "none" | "color" | "gradient"; value: string } => {
      const bgImage = cs.backgroundImage;
      if (bgImage && bgImage !== "none") {
        const parsed = parseLinearGradient(bgImage);
        if (parsed) return { type: "gradient", value: getOrCreateGradient(parsed) };
      }
      const bgColor = cs.backgroundColor;
      if (bgColor && !/rgba?\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(bgColor)) return { type: "color", value: bgColor };
      return { type: "none", value: "" };
    };
    const maskIdByKey = new Map<string, string>();
    // A CSS mask gradient fades by ALPHA, not luminance — SVG <mask> defaults
    // to luminance. Using a solid white stop whose stop-opacity carries the
    // source alpha makes luminance*alpha reduce to the same alpha ramp, so
    // the two agree without needing mask-type="alpha" support everywhere.
    const resolveMask = (cs: CSSStyleDeclaration): string | null => {
      const maskImage = cs.getPropertyValue("mask-image") || cs.getPropertyValue("-webkit-mask-image");
      if (!maskImage || maskImage === "none") return null;
      const parsed = parseLinearGradient(maskImage);
      if (!parsed) return null;
      const key = JSON.stringify(parsed);
      let id = maskIdByKey.get(key);
      if (!id) {
        id = `mask-${maskIdByKey.size}`;
        maskIdByKey.set(key, id);
        const { x1, y1, x2, y2 } = angleToCoords(parsed.angleDeg);
        const gradId = `${id}-g`;
        const stops = parsed.stops.map(s => `<stop offset="${s.pct}%" stop-color="#ffffff" stop-opacity="${splitColorAlpha(s.color).alpha}"/>`).join("");
        gradDefs.push(`<linearGradient id="${gradId}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops}</linearGradient>`);
        gradDefs.push(`<mask id="${id}"><rect x="-10%" y="-10%" width="120%" height="120%" fill="url(#${gradId})"/></mask>`);
      }
      return id;
    };

    // ── Box-shadow: this app's card shadows are hard-edged (0 blur radius —
    // a flat offset duplicate, not a soft glow), so most exports never touch
    // the blur path at all; it's included for designs that do use a soft
    // shadow. Multiple comma-separated shadows aren't split — real designs
    // here use exactly one.
    const parseBoxShadow = (raw: string): { color: string; offsetX: number; offsetY: number; blur: number; spread: number } | null => {
      if (!raw || raw === "none" || /^inset\b/.test(raw.trim())) return null;
      const first = splitTopLevel(raw, ",")[0].trim();
      const colorMatch = first.match(/rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}/);
      const color = colorMatch ? colorMatch[0] : "rgba(0,0,0,0.5)";
      const [offsetX = 0, offsetY = 0, blur = 0, spread = 0] = (color ? first.replace(color, "") : first).trim().split(/\s+/).filter(Boolean).map(v => parseFloat(v) || 0);
      return { color, offsetX, offsetY, blur, spread };
    };

    // Wraps text to the element's real content width using the same font
    // the SVG will declare, since SVG <text> never auto-wraps — without
    // this, long copy (card body text, headlines) rendered as a single
    // <text> ran straight off the edge of the frame instead of wrapping
    // onto multiple lines like the on-screen design.
    const measureCtx = document.createElement("canvas").getContext("2d");
    const wrapText = (text: string, fontSpec: string, maxWidth: number): string[] => {
      if (!measureCtx || !(maxWidth > 0)) return [text];
      measureCtx.font = fontSpec;
      const words = text.split(/\s+/).filter(Boolean);
      if (!words.length) return [];
      const lines: string[] = [];
      let current = words[0];
      for (let i = 1; i < words.length; i++) {
        const trial = `${current} ${words[i]}`;
        if (measureCtx.measureText(trial).width > maxWidth) { lines.push(current); current = words[i]; }
        else current = trial;
      }
      lines.push(current);
      return lines;
    };

    const contentRect = content.getBoundingClientRect();

    const walkNode = (node: Element) => {
      for (const child of Array.from(node.children) as HTMLElement[]) {
        const tag = child.tagName.toLowerCase();
        if (["script", "style", "link", "meta"].includes(tag)) continue;

        const rect = child.getBoundingClientRect();
        const cs = getComputedStyle(child);
        const text = (child.textContent || "").trim();
        const hasChildren = child.children.length > 0;

        const x = rect.left - contentRect.left;
        const y = rect.top - contentRect.top;
        const width = rect.width;
        const height = rect.height;
        const opacity = parseFloat(cs.opacity) || 1;
        const radius = parseFloat(cs.borderTopLeftRadius) || 0;

        // Box-shadow — a separate rect painted BEFORE (i.e. beneath) the
        // element's own fill, matching CSS's default shadow stacking.
        const shadow = width > 0 && height > 0 ? parseBoxShadow(cs.boxShadow) : null;
        if (shadow) {
          const blurAttr = shadow.blur > 0 ? ` filter="url(#${getOrCreateFilter([`<feGaussianBlur stdDeviation="${(shadow.blur / 2).toFixed(2)}"/>`])})"` : "";
          const sx = x + shadow.offsetX - shadow.spread, sy = y + shadow.offsetY - shadow.spread;
          const sw = Math.max(0, width + shadow.spread * 2), sh = Math.max(0, height + shadow.spread * 2);
          svgParts.push(`<rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" fill="${escXml(shadow.color)}" rx="${radius}" opacity="${opacity}"${blurAttr}/>`);
        }

        // Background (solid or gradient) — separate from border, since a
        // border-only element (fill: none) still needs to paint SOMETHING,
        // and a divider that's only border-bottom (this app's card headers,
        // image containers) has no "uniform border" to fold into one rect.
        const fillInfo = resolveBackgroundFill(cs);
        const maskId = resolveMask(cs);
        const maskAttr = maskId ? ` mask="url(#${maskId})"` : "";
        if (fillInfo.type !== "none" && width > 0 && height > 0) {
          const fill = fillInfo.type === "gradient" ? `url(#${fillInfo.value})` : escXml(fillInfo.value);
          svgParts.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}" rx="${radius}" opacity="${opacity}"${maskAttr}/>`);
        }

        // Border — a plain outline rect when all 4 sides match (the common
        // case), otherwise individual <line> segments per side, since real
        // designs here also use single-side borders as dividers
        // (`.card-header{border-bottom:2px solid}`) that a "check the top
        // side only" shortcut would silently miss.
        if (width > 0 && height > 0) {
          const sides = (["Top", "Right", "Bottom", "Left"] as const).map(edge => {
            const w = parseFloat((cs as any)[`border${edge}Width`]) || 0;
            return { w, style: (cs as any)[`border${edge}Style`], color: (cs as any)[`border${edge}Color`], has: w > 0 && (cs as any)[`border${edge}Style`] !== "none" };
          });
          const [top, right, bottom, left] = sides;
          const uniform = top.has && right.has && bottom.has && left.has
            && [right, bottom, left].every(s => s.w === top.w && s.color === top.color);
          if (uniform) {
            // SVG strokes are centered on the path; CSS borders sit fully
            // inside the box. Insetting by half the stroke width lines the
            // stroke's outer edge up with the CSS border's outer edge.
            const inset = top.w / 2;
            svgParts.push(`<rect x="${x + inset}" y="${y + inset}" width="${Math.max(0, width - top.w)}" height="${Math.max(0, height - top.w)}" fill="none" rx="${radius}" stroke="${escXml(top.color)}" stroke-width="${top.w}" opacity="${opacity}"/>`);
          } else {
            if (top.has) svgParts.push(`<line x1="${x}" y1="${y + top.w / 2}" x2="${x + width}" y2="${y + top.w / 2}" stroke="${escXml(top.color)}" stroke-width="${top.w}" opacity="${opacity}"/>`);
            if (bottom.has) svgParts.push(`<line x1="${x}" y1="${y + height - bottom.w / 2}" x2="${x + width}" y2="${y + height - bottom.w / 2}" stroke="${escXml(bottom.color)}" stroke-width="${bottom.w}" opacity="${opacity}"/>`);
            if (left.has) svgParts.push(`<line x1="${x + left.w / 2}" y1="${y}" x2="${x + left.w / 2}" y2="${y + height}" stroke="${escXml(left.color)}" stroke-width="${left.w}" opacity="${opacity}"/>`);
            if (right.has) svgParts.push(`<line x1="${x + width - right.w / 2}" y1="${y}" x2="${x + width - right.w / 2}" y2="${y + height}" stroke="${escXml(right.color)}" stroke-width="${right.w}" opacity="${opacity}"/>`);
          }
        }

        if (tag === "img") {
          const src = child.getAttribute("src") || "";
          if (src && width > 0 && height > 0) {
            svgParts.push(`<image x="${x}" y="${y}" width="${width}" height="${height}" href="${escXml(src)}" preserveAspectRatio="xMidYMid slice"${buildFilterChain(cs.filter)}${maskAttr}/>`);
          }
        } else if (text && !hasChildren) {
          const fontFamily = cs.fontFamily.replace(/["']/g, "");
          const fontSize = cs.fontSize;
          const fontWeight = cs.fontWeight;
          const color = cs.color;
          const textAlign = cs.textAlign;
          // Text sits in the CONTENT box, inset from the border box by
          // padding/border — using the border box directly (as the first
          // pass did) placed text too high and too far left/right on any
          // padded element, e.g. a card body with `padding: 10px 8px`.
          const padL = parseFloat(cs.paddingLeft) || 0, padR = parseFloat(cs.paddingRight) || 0, padT = parseFloat(cs.paddingTop) || 0;
          const bL = parseFloat(cs.borderLeftWidth) || 0, bR = parseFloat(cs.borderRightWidth) || 0, bT = parseFloat(cs.borderTopWidth) || 0;
          const contentX = x + bL + padL;
          const contentY = y + bT + padT;
          const contentWidth = Math.max(0, width - bL - bR - padL - padR);
          const anchor = textAlign === "center" ? "middle" : (textAlign === "right" || textAlign === "end") ? "end" : "start";
          const textX = textAlign === "center" ? contentX + contentWidth / 2 : (textAlign === "right" || textAlign === "end") ? contentX + contentWidth : contentX;
          const lines = wrapText(text, `${fontWeight} ${fontSize} ${fontFamily}`, contentWidth);
          let lineHeight = parseFloat(cs.lineHeight);
          if (!cs.lineHeight || cs.lineHeight === "normal" || Number.isNaN(lineHeight)) lineHeight = parseFloat(fontSize) * 1.2;
          const baseY = contentY + parseFloat(fontSize);
          const tspans = lines.map((line, i) => `<tspan x="${textX}" y="${baseY + i * lineHeight}">${escXml(line)}</tspan>`).join("");
          svgParts.push(`<text font-family="${escXml(fontFamily)}" font-size="${escXml(fontSize)}" font-weight="${escXml(fontWeight)}" fill="${escXml(color)}" text-anchor="${anchor}" opacity="${opacity}">${tspans}</text>`);
        }

        walkNode(child);
      }
    };

    walkNode(content);
    host.remove();

    // Extract font links
    const fontImportRe = /@import\s+url\(['"]?(https:\/\/fonts\.googleapis\.com[^'")]+)['"]?\)\s*;/g;
    const fontLinks: string[] = [];
    let fm;
    while ((fm = fontImportRe.exec(css)) !== null) {
      // Google Fonts URLs are built with `&` between query params
      // (…&display=swap) — a bare `&` in XML must start a valid entity
      // reference, so every SVG export with a Google Font (the overwhelming
      // majority of designs) produced a file that failed to parse: "This
      // page contains the following errors: error … EntityRef: expecting
      // ';'". escXml turns it into the required `&amp;`.
      fontLinks.push(`<link rel="stylesheet" href="${escXml(sanitizeGoogleFontUrl(fm[1]))}"/>`);
    }

    // Matches the balanced url(...) first, THEN the statement-ending `;` —
    // a Google Fonts URL commonly has its own `;` inside (wght@400;700),
    // which a naive /@import[^;]+;/ would stop at prematurely, leaving a
    // dangling css fragment (e.g. "700&display=swap');") in the CDATA block.
    const cleanCss = css.replace(/@import\s+url\([^)]*\)[^;]*;/g, "").replace(/@font-face\s*\{[^}]*\}/g, "");

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xhtml="http://www.w3.org/1999/xhtml"
     width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <style><![CDATA[${cleanCss}]]></style>
    ${fontLinks.join("\n  ")}
    ${filterDefs.join("\n    ")}
    ${gradDefs.join("\n    ")}
  </defs>
  <rect width="${w}" height="${h}" fill="${escXml(bg)}"/>
  ${svgParts.join("\n  ")}
</svg>`;
  }, []);

  // Capture a single frame to a PNG/JPG blob via rasterizeFrame (see frameCapture.ts
  // for why this replaced html2canvas — it dropped CSS filters and body/html styles).
  const captureFrameToPng = useCallback(async (frame: FrameData, scale: number = 2, format: "png" | "jpg" = "png", inlineOpts?: InlineImageOptions): Promise<Blob | null> => {
    // JPEG has no alpha channel: an unresolved "transparent" background would
    // rasterize as solid BLACK once flattened, not white — always resolve to
    // an opaque color for jpg. PNG keeps true transparency when the frame has
    // none set.
    const background = frame.background || (format === "jpg" ? "#ffffff" : "transparent");
    try {
      const canvas = await rasterizeFrame(
        { html: frame.html, css: frame.css, width: frame.width, height: frame.height, background },
        scale,
        inlineOpts,
      );
      const mimeType = format === "jpg" ? "image/jpeg" : "image/png";
      const quality = format === "jpg" ? 0.92 : undefined;
      return await canvasToBlob(canvas, mimeType, quality);
    } catch (err) {
      console.warn("[Export] Capture failed", err);
      return null;
    }
  }, []);

  // Reparación same-origin para rasters: una imagen sin CORS (hotlink, 403 en
  // el browser) se re-hostea en Storage vía /api/assets/upload?url=… — el
  // Worker descarga sin restricción de origen — y el inline reintenta contra
  // esa URL de plataforma. Dedup por sesión: la misma URL no genera assets
  // duplicados aunque varios frames la usen.
  const repairedUrlCacheRef = useRef<Map<string, string | null>>(new Map());
  const repairFrameImageForRaster = useCallback(async (url: string): Promise<string | null> => {
    const cached = repairedUrlCacheRef.current.get(url);
    if (cached !== undefined) return cached;
    let result: string | null = null;
    try {
      let host = "imagen remota";
      try { host = new URL(url).hostname || host; } catch { /* url malformada: nombre genérico */ }
      const res = await apiFetch<any>("/api/assets/upload", {
        method: "POST",
        body: JSON.stringify({ name: `Imagen remota — ${host}`, url, workspaceId: templateWorkspaceId || undefined }),
      });
      result = res?.url ? String(res.url) : null;
    } catch {
      result = null;
    }
    repairedUrlCacheRef.current.set(url, result);
    return result;
  }, [templateWorkspaceId]);

  // Modo Foto sobre un frame completo: rasteriza la copia pixel (2×, mismo
  // motor que video/covers), la sube a Assets (assetIdFromUrl deriva de la
  // URL → catálogo, recetas y MCP caen en la misma fila) y abre el revelado
  // sobre esa copia. Cache por frame+hash: reentrar no re-rasteriza ni
  // re-sube si el diseño no cambió.
  const handleOpenFrameInPhotoMode = useCallback(async (frame: FrameData) => {
    if (frameRasterBusyId) return;
    const hash = frameSourceHash([frame.id, frame.html, frame.css, frame.width, frame.height, frame.background]);
    const cacheKey = `${frame.id}:${hash}`;
    let rasterUrl = frameRasterCacheRef.current.get(cacheKey);
    let repairedCount = 0;
    const unrepairedUrls: string[] = [];
    if (!rasterUrl) {
      setFrameRasterBusyId(frame.id);
      try {
        const blob = await captureFrameToPng(frame, 2, "png", {
          repair: async (url) => {
            const platformUrl = await repairFrameImageForRaster(url);
            if (platformUrl) repairedCount++;
            return platformUrl;
          },
          onUnrepaired: (url) => unrepairedUrls.push(url),
        });
        if (!blob) throw new Error("No se pudo rasterizar el frame (¿recursos externos con CORS?)");
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result));
          fr.onerror = () => reject(new Error("No se pudo codificar el raster"));
          fr.readAsDataURL(blob);
        });
        const res = await apiFetch<any>("/api/assets/upload", {
          method: "POST",
          body: JSON.stringify({ name: `Frame pixel — ${frame.name || "frame"}`, data: dataUrl, workspaceId: templateWorkspaceId || undefined }),
        });
        if (!res?.url) throw new Error(res?.error || "La subida del raster falló");
        rasterUrl = String(res.url);
        frameRasterCacheRef.current.set(cacheKey, rasterUrl);
      } catch (err: any) {
        addToast(err?.message || "No se pudo abrir el frame en Modo Foto", "error");
        return;
      } finally {
        setFrameRasterBusyId(null);
      }
    }
    setPhotoModeTarget({
      frameId: frame.id,
      layerId: frameRasterLayerId(frame.id),
      src: rasterUrl,
      name: `${frame.name || "Frame"} (raster)`,
      recipeAttr: null,
      kind: "frameRaster",
    });
    setPhotoFramePickerOpen(false);
    setPhotoModeOpen(true);
    // Visibilidad del borde silencioso: cuántas imágenes se rescataron y
    // cuántas quedaron fuera (huecos) — el raster ya está abierto.
    if (repairedCount > 0) {
      addToast(repairedCount === 1
        ? "1 imagen externa sin CORS se re-hosteó para incluirse en la copia."
        : `${repairedCount} imágenes externas sin CORS se re-hostearon para incluirse.`, "info");
    }
    if (unrepairedUrls.length > 0) {
      addToast(`Atención: ${unrepairedUrls.length} imagen(es) externa(s) no se pudo incluir (link roto, privado o >5MB) — quedará como hueco en la copia.`, "error");
    }
  }, [frameRasterBusyId, captureFrameToPng, repairFrameImageForRaster, templateWorkspaceId, addToast]);

  // El raster activo entra a la tira de targets del overlay — sin esto el
  // filmstrip no lo lista y el target quedaría inaccesible tras cambiar de foto.
  const photoExtraTargets = useMemo(
    () => (photoModeTarget?.kind === "frameRaster" ? [photoModeTarget] : undefined),
    [photoModeTarget],
  );
  // Etiqueta de la foto seleccionada para el picker (misma derivación que
  // handleOpenPhotoMode; null = no hay foto img seleccionada).
  const selectedPhotoLabel = useMemo(() => {
    const el = selectedElement;
    if (!el || el.tag !== "img" || !el.src) return null;
    const frame = frames.find(f => f.id === el.frameId);
    return (frame && getLayerAttribute(frame.html, el.layerId, "data-layer-name")) || "Foto";
  }, [selectedElement, frames]);

  /* Capture the selected frame as a card-sized JPEG. The cover endpoint has a
     1MB decoded-byte budget; rasterizing a 1080×1350 artboard at 1.5× made a
     normal snapshot exceed it before Supabase was ever reached. */
  const handleCoverCapture = useCallback(async (): Promise<string | null> => {
    if (!selectedFrame) return null;
    try {
      const scale = thumbnailScale(selectedFrame.width, selectedFrame.height);
      const blob = await captureFrameToPng(selectedFrame, scale, "jpg");
      if (!blob) return null;
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    } catch { return null; }
  }, [selectedFrame, captureFrameToPng]);

  // REQ-027: feedback post-export — toast con nombre + tamaño real; un
  // archivo de 0 bytes es un fallo, no un éxito silencioso.
  const exportBlobWithToast = useCallback((blob: Blob, filename: string) => {
    const size = blob.size;
    const pretty = size >= 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(1)} MB`
      : size >= 1024 ? `${Math.round(size / 1024)} KB`
      : `${size} B`;
    if (size === 0) {
      addToast(`Export falló: "${filename}" salió vacío (0 bytes)`, "error");
      return;
    }
    downloadBlob(blob, filename);
    addToast(`✓ ${filename} · ${pretty}`, "success");
  }, [addToast]);

  // Export operates on whichever frames are currently SELECTED (a multi-frame
  // selection on the canvas — see exportTargetFrames below), not a "current
  // frame vs literally every frame" toggle. A user with 7 frames who wants
  // to hand a client only 3 selects those 3 and exports; there's no longer a
  // separate "all frames" mode to reach for.
  const handleExportFramesPNG = useCallback(async (targetFrames: FrameData[], format: "png" | "jpg" = "png") => {
    for (const frame of targetFrames) {
      const blob = await captureFrameToPng(frame, 2, format);
      if (!blob) continue;
      exportBlobWithToast(blob, `${frame.name.replace(/[<>:"/\\|?*]/g, "_")}.${format}`);
      if (targetFrames.length > 1) await new Promise(r => setTimeout(r, 300));
    }
  }, [captureFrameToPng, exportBlobWithToast]);

  // SVG export bakes external images (Storage URLs) into data: URIs first —
  // a downloaded .svg opened directly in a browser tab CAN load external
  // images fine, but most consumers (thumbnailers, dragging it into another
  // <img>, pasting into design tools) treat it as an image resource, which
  // triggers the exact same "SVG-as-image skips external resources" browser
  // rule documented in frameCapture.ts. Inlining makes the file self-contained
  // everywhere, matching the PNG/JPG export's guarantee.
  const handleExportFramesSVG = useCallback(async (targetFrames: FrameData[]) => {
    for (const frame of targetFrames) {
      const { html, css } = await inlineFrameImages(frame.html, frame.css);
      const svgString = await buildFrameSvg({ ...frame, html, css });
      const blob = new Blob([svgString], { type: "image/svg+xml" });
      exportBlobWithToast(blob, `${frame.name.replace(/[<>:"/\\|?*]/g, "_")}.svg`);
      if (targetFrames.length > 1) await new Promise(r => setTimeout(r, 200));
    }
  }, [buildFrameSvg, exportBlobWithToast]);

  // ── PDF export via jsPDF ──
  const handleExportFramesPDF = useCallback(async (targetFrames: FrameData[]) => {
    const { jsPDF } = await import("jspdf");
    for (const frame of targetFrames) {
      const blob = await captureFrameToPng(frame, 2, "png");
      if (!blob) continue;
      const reader = new FileReader();
      const imgData = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const pdf = new jsPDF({
        orientation: (frame.width || 1080) > (frame.height || 1080) ? "landscape" : "portrait",
        unit: "px",
        format: [frame.width || 1080, frame.height || 1080],
      });
      pdf.addImage(imgData, "PNG", 0, 0, frame.width || 1080, frame.height || 1080);
      pdf.save(`${frame.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf`);
      if (targetFrames.length > 1) await new Promise(r => setTimeout(r, 300));
    }
  }, [captureFrameToPng]);

  // ── Export de imprenta (REQ 300dpi/CMYK): raster a escala calculada
  //  (≥300dpi reales sobre el área dibujada), PDF con página física en mm
  //  y — si hay perfil CMYK — transformación en el worker de Ghostscript.
  //  El diseño SIEMPRE queda en RGB: el CMYK toca solo el archivo exportado.
  const fetchPrintIcc = useCallback(async (profile: PrintOptions["profile"]): Promise<ArrayBuffer> => {
    const manifest = await loadPrintManifest();
    const meta = PRINT_PROFILES.find(p => p.id === profile);
    const file = manifest?.profiles?.[profile]?.file || meta?.iccFile;
    if (!file) throw new Error(`Perfil ICC no disponible (${profile})`);
    const res = await fetch(`${PRINT_ENGINE_BASE}/icc/${file}`);
    if (!res.ok) throw new Error(`No se pudo leer el perfil ICC ${file} (${res.status})`);
    return res.arrayBuffer();
  }, []);

  const handleExportFramesPrint = useCallback(async (targetFrames: FrameData[], options: PrintOptions, report: (p: PrintProgressInfo) => void) => {
    const profileMeta = PRINT_PROFILES.find(p => p.id === options.profile) || null;
    const needsCmyk = profileMeta?.iccFile != null;
    let iccBytes: ArrayBuffer | null = null;
    if (needsCmyk) {
      report({ phase: "preparing", current: 0, total: targetFrames.length });
      iccBytes = await fetchPrintIcc(options.profile);
      await ensurePrintEngine((loaded, total) =>
        report({ phase: "preparing", current: 0, total: targetFrames.length, message: `${Math.round((loaded / Math.max(1, total)) * 100)}%` }));
    }
    for (let i = 0; i < targetFrames.length; i++) {
      const frame = targetFrames[i];
      const geo = computePrintGeometry(frame.width, frame.height, options.marginMm, { scale: options.scale, bleedMm: options.bleedMm, cropMarks: options.cropMarks });
      report({ phase: "rendering", current: i + 1, total: targetFrames.length, message: `Renderizando "${frame.name}" → ${geo.rasterW}×${geo.rasterH}px…` });
      const canvas = await rasterizeFrame(
        { html: frame.html, css: frame.css, width: frame.width, height: frame.height, background: printBackground(frame.background, options) },
        geo.scale,
      );
      const dataUrl = canvas.toDataURL(options.codec === "png" ? "image/png" : "image/jpeg", options.jpegQuality);
      const pdfBytes = await buildPrintPdf({ dataUrl, codec: options.codec, geometry: geo });
      // Nombre custom del dialog; con varios frames se numera para no chocar.
      const customName = options.filename.trim();
      const base = customName && targetFrames.length > 1 ? `${customName}_${i + 1}` : (customName || frame.name);
      const filename = printFilename(base, options.profile);
      if (needsCmyk && iccBytes) {
        report({ phase: "converting", current: i + 1, total: targetFrames.length, message: `Convirtiendo "${frame.name}" a CMYK (${profileMeta?.label})…` });
        const cmyk = await convertPdfToCmyk({
          pdfBytes, iccBytes, iccName: profileMeta!.iccFile!,
          // REQ F2: Acrobat debe mostrar el perfil elegido en Salida →
          // OutputIntent. El identifier es el registrado de la condición.
          outputConditionIdentifier: profileMeta!.condition!,
          outputConditionInfo: profileMeta!.label,
        });
        exportBlobWithToast(new Blob([cmyk], { type: "application/pdf" }), filename);
      } else {
        exportBlobWithToast(new Blob([pdfBytes], { type: "application/pdf" }), filename);
      }
      report({ phase: "rendering", current: i + 1, total: targetFrames.length, message: `✓ ${filename} · ${geo.rasterW}×${geo.rasterH}px · ${geo.effDpi.toFixed(0)} dpi efectivos` });
      if (targetFrames.length > 1) await new Promise(r => setTimeout(r, 300));
    }
  }, [fetchPrintIcc, exportBlobWithToast]);

  // ── Soft-proof (Fase 3): render ICC-preciso de cómo caerán los colores.
  //  Genera el PDF a escala baja, lo convierte a CMYK y rasteriza ESE pdf —
  //  lo que muestra el PNG es exactamente lo que imprime la máquina. ──
  const handlePrintProof = useCallback(async (frame: FrameData, options: PrintOptions, report: (p: PrintProgressInfo) => void): Promise<string> => {
    const profileMeta = PRINT_PROFILES.find(p => p.id === options.profile);
    if (!profileMeta?.iccFile) throw new Error("El soft-proof requiere un perfil CMYK");
    report({ phase: "proofing", current: 0, total: 1 });
    const iccBytes = await fetchPrintIcc(options.profile);
    const geo = computePrintGeometry(frame.width, frame.height, options.marginMm, { scale: options.scale, bleedMm: options.bleedMm, cropMarks: options.cropMarks });
    // Preview ~900px de ancho: mismo layout físico, raster de prueba.
    const proofScale = Math.min(geo.scale, Math.max(0.25, 900 / frame.width));
    const proofGeo = { ...geo, scale: proofScale };
    const canvas = await rasterizeFrame(
      { html: frame.html, css: frame.css, width: frame.width, height: frame.height, background: printBackground(frame.background, options) },
      proofGeo.scale,
    );
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    const pdfBytes = await buildPrintPdf({ dataUrl, codec: "jpeg", geometry: proofGeo });
    const renderDpi = Math.max(40, Math.min(150, Math.round(900 / (geo.drawnWmm / 25.4))));
    const png = await renderSoftProof({
      pdfBytes,
      iccBytes,
      iccName: profileMeta.iccFile,
      renderDpi,
      onEngineProgress: (loaded, total) => report({ phase: "proofing", current: 0, total: 1, message: `Motor ${Math.round((loaded / Math.max(1, total)) * 100)}%` }),
    });
    return URL.createObjectURL(png);
  }, [fetchPrintIcc]);

  // ── Separaciones (paridad parcial con Separations Preview): genera el
  //  PDF a escala baja, lo convierte a CMYK y lo rasteriza con pamcmyk32 —
  //  el worker parte la tira en 4 placas C/M/Y/K de cobertura de tinta. ──
  const handlePrintSeparations = useCallback(async (frame: FrameData, options: PrintOptions, report: (p: PrintProgressInfo) => void): Promise<SeparationsResult> => {
    const profileMeta = PRINT_PROFILES.find(p => p.id === options.profile);
    if (!profileMeta?.iccFile) throw new Error("Las separaciones requieren un perfil CMYK");
    report({ phase: "proofing", current: 0, total: 1 });
    const iccBytes = await fetchPrintIcc(options.profile);
    const geo = computePrintGeometry(frame.width, frame.height, options.marginMm, { scale: options.scale, bleedMm: options.bleedMm, cropMarks: options.cropMarks });
    // Preview ~900px de ancho: mismo layout físico, raster de prueba.
    const proofScale = Math.min(geo.scale, Math.max(0.25, 900 / frame.width));
    const proofGeo = { ...geo, scale: proofScale };
    const canvas = await rasterizeFrame(
      { html: frame.html, css: frame.css, width: frame.width, height: frame.height, background: printBackground(frame.background, options) },
      proofGeo.scale,
    );
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    const pdfBytes = await buildPrintPdf({ dataUrl, codec: "jpeg", geometry: proofGeo });
    const renderDpi = Math.max(40, Math.min(150, Math.round(900 / (geo.drawnWmm / 25.4))));
    return renderSeparations({
      pdfBytes,
      iccBytes,
      iccName: profileMeta.iccFile,
      renderDpi,
      onEngineProgress: (loaded, total) => report({ phase: "proofing", current: 0, total: 1, message: `Motor ${Math.round((loaded / Math.max(1, total)) * 100)}%` }),
    });
  }, [fetchPrintIcc]);

  const [showPasteHtml, setShowPasteHtml] = useState(false);
  const [batchCheckedFrameIds, setBatchCheckedFrameIds] = useState<Set<string>>(new Set());
  const [batchHoveredFrameId, setBatchHoveredFrameId] = useState<string | null>(null);
  const [showBatchMenu, setShowBatchMenu] = useState(false);
  const [showDesignImport, setShowDesignImport] = useState(false);

  // ── Unified Import router: one entry point that detects what was
  // dropped/picked and opens the right specialized tool (SVG editor,
  // design-file import, HTML/CSS import, or template restore), pre-loaded
  // with the file. handleImportRoute is declared further down (after
  // importTemplateFile exists) so it can list that as a dependency. ──
  const [showImportRouter, setShowImportRouter] = useState(false);
  const [routedImportFiles, setRoutedImportFiles] = useState<File[]>([]);

  // ── Design import handler (SVG/PSD/AI/FIG → new frame) ──
  const handleDesignImport = useCallback(async (results: ImportResult[]) => {
    if (!results.length) return;
    const stamp = Date.now();
    const updated = [...store.getSnapshot()] as FrameData[];
    const imported: FrameData[] = [];
    let replaced = 0;
    results.forEach((result, index) => {
      const marker = result.sourceKey ? `<!-- futuraria-import-source:${result.sourceKey} -->` : "";
      const previousIndex = marker && result.replacePrevious ? updated.findIndex(frame => frame.html.includes(marker)) : -1;
      const previous = previousIndex >= 0 ? updated[previousIndex] : null;
      const frame: FrameData = {
        id: previous?.id || `frame-${stamp}-${index}-${Math.random().toString(36).slice(2, 8)}`,
        name: result.name || `Imported Design ${index + 1}`,
        x: previous?.x ?? 100 + (frames.length + index) * 40,
        y: previous?.y ?? 100 + (frames.length + index) * 40,
        width: result.width || 1080,
        height: result.height || 1080,
        html: `${marker}${result.html}`,
        css: result.css,
        background: "#ffffff",
      };
      if (previousIndex >= 0) { updated[previousIndex] = frame; replaced += 1; }
      else updated.push(frame);
      imported.push(frame);
    });
    store.replaceAllWithUndo(updated, "import design");
    setSelectedFrameId(imported[0].id);
    autoSave(updated);
    const warnings = [...new Set(results.flatMap(result => result.warnings?.map(warning => warning.message) || (result.warning ? [result.warning] : [])))];
    const outcome = replaced ? `${imported.length} frame(s) importados; ${replaced} actualizados sin duplicar.` : `${imported.length} frame(s) importados.`;
    if (warnings.length) addToast(`${outcome} ${warnings.join(" ")}`, "info", true);
    else addToast(outcome, "success");
  }, [frames, store, setSelectedFrameId, autoSave, addToast]);

  // ── Canvas Guides state ──
  const [guides, setGuides] = useState<Guide[]>([]);
  // Guía seleccionada con click en su línea — el área de propiedades muestra
  // su X/Y y Delete la borra (REQ fix 4/5).
  const [selectedGuideId, setSelectedGuideId] = useState<string | null>(null);
  // Espejo para el efecto de teclado (registrado una sola vez): leer el ref
  // evita re-registrar todo el handler de atajos en cada cambio de selección.
  const selectedGuideIdRef = useRef<string | null>(null);
  selectedGuideIdRef.current = selectedGuideId;
  const selectedGuide = guides.find(g => g.id === selectedGuideId) ?? null;
  // La grilla arranca OCULTA (v59): es una guía de trabajo fino, no algo que
  // deba ensuciar el lienzo al abrir el editor. Se enciende desde Vista.
  const [showGrid, setShowGrid] = useState(false);
  // Letras de atajo de la barra de herramientas izquierda (V, H, R…) —
  // ocultas por default; el toggle vive en el menú Vista. Los textos de la
  // barra superior, en cambio, son siempre visibles (v60): no se ocultan.
  const [showToolbarShortcuts, setShowToolbarShortcuts] = useState(false);
  const [showRulers, setShowRulers] = useState(true);
  const [gridSize] = useState(8);
  const [showColumnPanel, setShowColumnPanel] = useState(false);
  const [columnConfig, setColumnConfig] = useState<ColumnConfig | null>(null);
  // Columnas session-only por decisión (sin schema nuevo): una config base,
  // overrides por frame, y un switch que aplica cada edición a TODOS los
  // frames en vez de solo al seleccionado (REQ fix 5).
  const [columnsEnabled, setColumnsEnabled] = useState(false);
  const [columnOverrides, setColumnOverrides] = useState<Record<string, ColumnConfig>>({});
  const [columnsApplyAll, setColumnsApplyAll] = useState(true);
  const applyColumnEdit = useCallback((patch: Partial<ColumnConfig>) => {
    if (columnsApplyAll) {
      setColumnConfig(prev => ({ ...(prev ?? { count: 6, gutter: 24, margin: 48 }), ...patch }));
      setColumnOverrides({});
      return;
    }
    if (!selectedFrameId) return;
    setColumnOverrides(prev => ({
      ...prev,
      [selectedFrameId]: {
        ...(prev[selectedFrameId] ?? columnConfig ?? { count: 6, gutter: 24, margin: 48 }),
        ...patch,
      },
    }));
  }, [columnsApplyAll, selectedFrameId, columnConfig]);
  // Config vigente para el panel: el override del frame cuando apply-all
  // está apagado, la base en caso contrario.
  const activeColumnConfig = (selectedFrameId && columnOverrides[selectedFrameId]) || columnConfig;
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [iconPickerAnchor, setIconPickerAnchor] = useState<DOMRect | null>(null);

  // ── Server-side BYOK key management (replaces localStorage) ──
  // Keys are encrypted server-side. The browser only knows whether a key
  // is configured and which model is selected — never the actual value.
  const geminiProvider = getProvider("google")!;
  const quiverProvider = getProvider("quiver")!;
  const wavespeedProvider = getProvider("wavespeed")!;
  const runwayProvider = getProvider("runway")!;
  const [keyStatuses, setKeyStatuses] = useState<KeyStatusMap>({});
  const [showGeminiKeyPrompt, setShowGeminiKeyPrompt] = useState(false);
  const [geminiKeyDraft, setGeminiKeyDraft] = useState("");
  const [quiverKeyDraft, setQuiverKeyDraft] = useState("");
  const [wavespeedKeyDraft, setWavespeedKeyDraft] = useState("");
  const [runwayKeyDraft, setRunwayKeyDraft] = useState("");
  const [keySaving, setKeySaving] = useState(false);

  const geminiConfigured = !!keyStatuses["google"]?.configured;
  const geminiModel = keyStatuses["google"]?.model || geminiProvider.models[0];
  const quiverConfigured = !!keyStatuses["quiver"]?.configured;
  const quiverModel = keyStatuses["quiver"]?.model || quiverProvider.models[0];
  const wavespeedConfigured = !!keyStatuses["wavespeed"]?.configured;
  const wavespeedModel = keyStatuses["wavespeed"]?.model || wavespeedProvider.models[0];
  const runwayConfigured = !!keyStatuses["runway"]?.configured;
  const runwayModel = keyStatuses["runway"]?.model || runwayProvider.models[0];

  const refreshKeyStatuses = useCallback(async () => {
    try {
      setKeyStatuses(await fetchKeyStatuses());
    } catch (err: any) {
      // 401 (not signed in yet) is expected on first paint; anything else
      // (500s from /api/keys, network failures) must be visible in console.
      if (!String(err?.message || "").includes("(401)")) {
        console.error("[keys] status fetch failed:", err?.message || err);
      }
    }
  }, []);
  useEffect(() => { void refreshKeyStatuses(); }, [refreshKeyStatuses]);
  // Auth token is set asynchronously by AuthProvider — re-fetch key statuses
  // once it arrives so BYOK keys survive a page reload.
  useEffect(() => {
    const handler = () => { void refreshKeyStatuses(); };
    window.addEventListener("futuraria:auth-token", handler);
    return () => window.removeEventListener("futuraria:auth-token", handler);
  }, [refreshKeyStatuses]);

  const handleSaveGeminiKey = useCallback(async (value: string) => {
    const v = value.trim();
    setKeySaving(true);
    try {
      if (v) {
        await saveProviderKey("google", v, geminiModel);
      } else {
        await deleteProviderKey("google");
      }
      await refreshKeyStatuses();
      addToast(v ? "✓ Gemini key guardada (servidor)" : "Gemini key eliminada", v ? "success" : "info");
    } catch (err: any) {
      addToast(`Error: ${err.message}`, "error");
    }
    setKeySaving(false);
  }, [geminiModel, refreshKeyStatuses, addToast]);

  const handleSaveQuiverKey = useCallback(async (value: string) => {
    const v = value.trim();
    setKeySaving(true);
    try {
      if (v) {
        await saveProviderKey("quiver", v, quiverModel);
      } else {
        await deleteProviderKey("quiver");
      }
      await refreshKeyStatuses();
      addToast(v ? "✓ Quiver key guardada (servidor)" : "Quiver key eliminada", v ? "success" : "info");
    } catch (err: any) {
      addToast(`Error: ${err.message}`, "error");
    }
    setKeySaving(false);
  }, [quiverModel, refreshKeyStatuses, addToast]);

  const handleSaveWavespeedKey = useCallback(async (value: string) => {
    const v = value.trim();
    setKeySaving(true);
    try {
      if (v) {
        await saveProviderKey("wavespeed", v, wavespeedModel);
      } else {
        await deleteProviderKey("wavespeed");
      }
      await refreshKeyStatuses();
      addToast(v ? "✓ WaveSpeed key guardada (servidor)" : "WaveSpeed key eliminada", v ? "success" : "info");
    } catch (err: any) {
      addToast(`Error: ${err.message}`, "error");
    }
    setKeySaving(false);
  }, [wavespeedModel, refreshKeyStatuses, addToast]);

  const handleSaveRunwayKey = useCallback(async (value: string) => {
    const v = value.trim();
    setKeySaving(true);
    try {
      if (v) {
        await saveProviderKey("runway", v, runwayModel);
      } else {
        await deleteProviderKey("runway");
      }
      await refreshKeyStatuses();
      addToast(v ? "✓ Runway key guardada (servidor)" : "Runway key eliminada", v ? "success" : "info");
    } catch (err: any) {
      addToast(`Error: ${err.message}`, "error");
    }
    setKeySaving(false);
  }, [runwayModel, refreshKeyStatuses, addToast]);

  /** Opens the AI config panel in the right sidebar — the user never has to
   *  leave the editor to set their key/model. Returns from any caller. */
  const openAiConfigPanel = useCallback(() => {
    setGeminiKeyDraft("");
    setRightPanelTab("ai");
    setShowRightPanel(true);
  }, []);

  // ── Quiver streaming vectorize state ──
  const [vectorizePreview, setVectorizePreview] = useState<string | null>(null);
  const [vectorizeLoading, setVectorizeLoading] = useState(false);
  const [vectorizeReasoning, setVectorizeReasoning] = useState("");
  const [cropMode, setCropMode] = useState<"auto" | "manual">("auto");
  const [cropRegion, setCropRegion] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const quiverAbortRef = useRef<AbortController | null>(null);
  const [saveRecipeMsg, setSaveRecipeMsg] = useState("");
  // ── Buscatrazos local (REQ-043 Fase 1): trace en el worker del navegador ──
  const [traceBusy, setTraceBusy] = useState(false);
  const traceCancelRef = useRef({ aborted: false });

  // Saves whichever frame(s) are currently selected — same selection
  // resolution rule used by Export (multi-select if there is one, else the
  // single active frame) — as a reusable Key Visual. Multi-frame recipes
  // store every frame in structure.frames; template_html/css keep the
  // first frame for older readers.
  const handleSaveRecipe = useCallback(async () => {
    const ids = selectedFrameIds.size > 0 ? selectedFrameIds : new Set(selectedFrameId ? [selectedFrameId] : []);
    const targetFrames = frames.filter(f => ids.has(f.id));
    if (targetFrames.length === 0) {
      setSaveRecipeMsg("✗ Select one or more frames first");
      setTimeout(() => setSaveRecipeMsg(""), 3000);
      return;
    }
    setSaveRecipeMsg("");
    try {
      const res = await apiFetch<{ recipeId: string; name: string }>("/api/recipes", {
        method: "POST",
        body: JSON.stringify({
          name: templateName || "Untitled Key Visual",
          description: `${templateName} - saved ${new Date().toLocaleDateString()}`,
          workspaceId: templateWorkspaceId,
          templateHtml: targetFrames[0].html || "",
          templateCss: targetFrames[0].css || "",
          structure: {
            layout: { width: targetFrames[0].width || 1080, height: targetFrames[0].height || 1080 },
            frames: targetFrames.map(f => ({ name: f.name, html: f.html || "", css: f.css || "", width: f.width, height: f.height })),
            colors: [],
            typography: [],
          },
        }),
      });
      setSaveRecipeMsg(`✓ Key Visual saved: ${res.name}`);
      setTimeout(() => setSaveRecipeMsg(""), 3000);
    } catch (e: any) {
      setSaveRecipeMsg(`✗ Failed: ${e.message}`);
      setTimeout(() => setSaveRecipeMsg(""), 4000);
    }
  }, [templateName, templateWorkspaceId, frames, selectedFrameId, selectedFrameIds]);

  // ── Extract Design System (R6: Human UI path) ──
  const handleExtractDesignSystem = useCallback(async () => {
    try {
      const mcpRes = await fetch("/mcp", {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/call",
          params: { name: "generate_design_artifacts", arguments: { templateId, action: "generate" } },
          id: 1,
        }),
      });
      const json = await mcpRes.json();
      const text = json?.result?.content?.[0]?.text;
      if (!text) throw new Error("No artifacts returned");
      const data = JSON.parse(text);

      const downloads = [
        { name: `${templateName.replace(/[<>:"/\\|?* ]/g, "_")}_DESIGN.md`, content: data.designMd, type: "text/markdown" },
        { name: `${templateName.replace(/[<>:"/\\|?* ]/g, "_")}_tokens.json`, content: data.tokensJson, type: "application/json" },
        { name: `${templateName.replace(/[<>:"/\\|?* ]/g, "_")}_shared.css`, content: data.sharedCss, type: "text/css" },
      ];

      for (const d of downloads) {
        if (!d.content) continue;
        const blob = new Blob([d.content], { type: d.type });
        downloadBlob(blob, d.name);
        await new Promise(r => setTimeout(r, 150));
      }
    } catch (e: any) {
      console.error("[Extract DS]", e);
      addToast("Error al extraer el design system: " + (e?.message || "Error desconocido"), "error");
    }
  }, [templateId, templateName, addToast]);

  // ── Design System de la marca (v35) ──
  // The "Design System" buttons (canvas context menu, mobile menu) open the
  // right-side panel where the user picks the brand, sees the ONE file
  // everything lands in, and extracts/appends from the selected frames.
  // The old behavior (silently downloading Design.md + tokens) only survives
  // as "Exportar copia local" inside the panel and the Export menu.
  const handleOpenDesignSystemPanel = useCallback(() => {
    setRightPanelTab("designSystem");
    setShowRightPanel(true);
  }, []);

  // Every frame's own stylesheet, combined into one downloadable file —
  // whole-template scope (see WHOLE_TEMPLATE_FORMATS), same as JSON/Tokens/
  // Design.md, not the per-frame selection PNG/JPG/SVG/PDF use.
  const handleExportCss = useCallback(() => {
    const combined = frames.map(f => `/* ── ${f.name} ── */\n${f.css || ""}`).join("\n\n");
    const blob = new Blob([combined], { type: "text/css" });
    downloadBlob(blob, `${templateName.replace(/[<>:"/\\|?* ]/g, "_")}.css`);
  }, [frames, templateName]);

  // ── Publish Style to Style Library (saves to brand_guidelines) ──
  // Extracts colors/typography/CSS from EVERY frame in this template (not
  // just the one selected in the canvas — generate_design_artifacts always
  // reads tpl.frames in full) and either creates a new Style Library entry
  // or auto-merges into an existing one with a matching "fingerprint".
  const [publishingStyle, setPublishingStyle] = useState(false);
  // Captures a style from whichever frame(s) are currently selected (not
  // "every frame in the template" — a template can hold several unrelated
  // designs) under an explicit name the caller supplies. Naming is on
  // purpose never inferred from the frame or template name: that's what was
  // silently colliding different captures into the same Style Library
  // entry.
  const handlePublishStyle = useCallback(async (name: string): Promise<boolean> => {
    const ids = selectedFrameIds.size > 0 ? selectedFrameIds : new Set(selectedFrameId ? [selectedFrameId] : []);
    if (ids.size === 0) {
      addToast("Selecciona uno o varios frames primero.", "error");
      return false;
    }
    if (!name.trim()) {
      addToast("El estilo necesita un nombre.", "error");
      return false;
    }
    setPublishingStyle(true);
    try {
      const mcpRes = await fetch("/mcp", {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/call",
          params: { name: "generate_design_artifacts", arguments: { templateId, action: "publish", brandName: name.trim(), frameIds: [...ids] } },
          id: 1,
        }),
      });
      const json = await mcpRes.json();
      if (json?.error) throw new Error(json.error.message);
      const text = json?.result?.content?.[0]?.text;
      if (!text) throw new Error("No response from publish");
      const data = JSON.parse(text);
      if (data._published) {
        const msg = data.autoMerged
          ? `Estilo "${name.trim()}" actualizado (ya existía con ese nombre)`
          : `Estilo publicado en Style Library como "${name.trim()}"`;
        addToast(msg + (data.brandId ? ` (brandId: ${data.brandId})` : ""), "success");
        return true;
      }
      throw new Error("Publish did not complete");
    } catch (e: any) {
      console.error("[Publish Style]", e);
      addToast("Error al publicar estilo: " + (e?.message || "Error desconocido"), "error");
      return false;
    } finally {
      setPublishingStyle(false);
    }
  }, [templateId, selectedFrameId, selectedFrameIds, addToast]);

  // ── Template (workspace) rename ──
  const commitTemplateRename = useCallback(async () => {
    if (!templateId || editingTemplateName === null) return;
    const trimmed = editingTemplateName.trim();
    if (!trimmed || trimmed === templateName) { setEditingTemplateName(null); return; }
    try {
      const result = await mcpCall("rename_template", { templateId, name: trimmed });
      if (result?.success) {
        setTemplateName(trimmed);
      } else {
        addToast("No se pudo renombrar el template.", "error");
      }
    } catch (err) {
      console.error("[TemplateRename] Error:", err);
      addToast("Error al renombrar el template.", "error");
    }
    setEditingTemplateName(null);
  }, [templateId, editingTemplateName, templateName, addToast]);

  const handleExportJSON = useCallback(async () => {
    const tpl = await getTemplate(templateId);
    if (tpl) {
      const blob = new Blob([JSON.stringify({ ...tpl, frames, canvasObjects: canvasObjectsRef.current }, null, 2)], { type: "application/json" });
      downloadBlob(blob, `${templateName}.futuraria.json`);
    }
  }, [templateId, templateName, frames]);

  const [showLayersPanel, setShowLayersPanel] = useState(false);
  // `hasClipboard` is sampled when the menu opens rather than read on every
  // render: the clipboard lives in localStorage, and the menu only needs to
  // know whether Paste is worth offering at the moment it is shown.
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; hasClipboard: boolean; maskTarget: ContextMenuMaskTarget | null } | null>(null);

  const [showInsertBar, setShowInsertBar] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showVersionPanel, setShowVersionPanel] = useState(false);
  const [layoutMode, setLayoutMode] = useState<"fixed" | "smart">("fixed");
  const [mcpLoading, setMcpLoading] = useState<string | null>(null);
  const [mcpMsg, setMcpMsg] = useState("");
  const [clipboardStyle, setClipboardStyle] = useState<string | null>(null);
  const lockedLayersByFrame = useMemo(() => new Map(
    frames.map(frame => [frame.id, getLayerIdsWithDeclaration(frame.css, "pointer-events", "none")]),
  ), [frames]);
  const hiddenLayersByFrame = useMemo(() => new Map(
    frames.map(frame => [frame.id, getLayerIdsWithDeclaration(frame.css, "display", "none")]),
  ), [frames]);

  // ── Copy / Paste Style ──
  const handleCopyStyle = useCallback(() => {
    if (!selectedElement) return;
    const declarations = getExactRuleDeclarations(activeCss, selectedElement.selector);
    const styleDeclarations = declarations
      ? filterCssDeclarations(declarations, GEOMETRY_PROPERTIES)
      : Object.entries(selectedElement.computedStyles)
        .filter(([property, value]) => COPY_STYLE_PROPERTIES.has(property) && value && value !== "none" && value !== "normal")
        .map(([property, value]) => `${property}: ${value};`)
        .join("\n");
    if (styleDeclarations) {
      setClipboardStyle(styleDeclarations);
      setMcpMsg("✓ Style copied");
      setTimeout(() => setMcpMsg(""), 1500);
    }
  }, [selectedElement, activeCss]);

  const handlePasteStyle = useCallback(() => {
    if (!selectedElement || !clipboardStyle) return;
    let updated = activeCss;
    for (const declaration of parseCssDeclarations(clipboardStyle)) {
      updated = updateCssProperty(updated, selectedElement.selector, declaration.property, declaration.value);
    }
    handleCssChange(updated);
    setMcpMsg("✓ Style pasted");
    setTimeout(() => setMcpMsg(""), 1500);
  }, [selectedElement, clipboardStyle, activeCss, handleCssChange]);

  // ── Lock / Hide toggle ──
  const handleLockToggle = useCallback((frameId: string, layerId: string, locked: boolean) => {
    const frame = frames.find(item => item.id === frameId);
    if (!frame) return;
    const selector = `[data-layer-id="${layerId}"]`;
    const updated = locked
      ? appendCssOverride(frame.css, selector, "pointer-events", "none !important")
      : removeCssOverride(frame.css, selector, "pointer-events", "none !important");
    handleFrameCssChange(frameId, updated);
  }, [frames, handleFrameCssChange]);

  const handleHideToggle = useCallback((frameId: string, layerId: string, hidden: boolean) => {
    const frame = frames.find(item => item.id === frameId);
    if (!frame) return;
    const selector = `[data-layer-id="${layerId}"]`;
    const updated = hidden
      ? appendCssOverride(frame.css, selector, "display", "none !important")
      : removeCssOverride(frame.css, selector, "display", "none !important");
    handleFrameCssChange(frameId, updated);
  }, [frames, handleFrameCssChange]);

  // ── Generic MCP call helper ──
  const callMcp = useCallback(async (method: string, params: any) => {
    const res = await apiFetch<any>("/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 0 }),
    });
    const text = res?.result?.content?.[0]?.text;
    return text ? (typeof text === "string" ? JSON.parse(text) : text) : res?.result;
  }, []);

  // ── Reload template data from server after MCP mutations ──
  const reloadFromServer = useCallback(async () => {
    const tpl = await getTemplate(templateId);
    const t = tpl as any;
    if (t?.frames && Array.isArray(t.frames)) {
      const currentFrames = framesRef.current;
      // Merge: preserve local frame data (x, y, w, h, etc), update html/css from server
      const updated = t.frames.map((f: any) => {
        // Server/MCP payloads can reintroduce duplicate layer ids — normalize
        // here too, not only on first load.
        const unique = dedupeLayerIds(f.html ?? "", f.css ?? "", createLayerId);
        const local = currentFrames.find(lf => lf.id === f.id);
        if (local) {
          return { ...local, html: unique.html, css: unique.css };
        }
        // New frame from server (e.g., created by MCP tool)
        return {
          id: f.id,
          name: f.name || "Frame",
          x: f.x ?? 0, y: f.y ?? 0,
          width: f.width ?? 1080, height: f.height ?? 1080,
          html: unique.html, css: unique.css,
          background: f.background ?? "#ffffff",
        };
      });
      if (updated.length > 0) {
        store.replaceAllWithUndo(updated, "edit");
        autoSaveRef.current(updated);
      }
    }
  }, [templateId]);

  // ── Icon Picker: insert into a frame, or as a canvas object outside any
  // frame — either is fine per spec, always appended last so it paints
  // above every existing layer. ──
  const [iconInsertError, setIconInsertError] = useState("");

  const insertIconIntoFrame = useCallback(async (icon: IconPayload, frameId: string, x: number, y: number) => {
    try {
      const res = await apiFetch<any>("/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0", method: "insert_icon",
          params: { templateId, frameId, icon: icon.name, library: icon.library, style: icon.style, size: icon.size, color: icon.color, x, y },
          id: 1,
        }),
      });
      if (res?.error) throw new Error(res.error.message);
      setIconInsertError("");
      addToast("✓ Icono insertado", "success");
      reloadFromServer();
    } catch (e: any) {
      setIconInsertError(e?.message || "No se pudo insertar el icono.");
    }
  }, [templateId, addToast, reloadFromServer]);

  const insertIconAsOrphan = useCallback(async (icon: IconPayload, worldPos?: { x: number; y: number }) => {
    try {
      const res = await apiFetch<any>("/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0", method: "get_icon_svg",
          params: { name: icon.name, library: icon.library, style: icon.style, color: icon.color },
          id: 1,
        }),
      });
      if (res?.error) throw new Error(res.error.message);
      const content = res?.result?.content?.[0];
      const data = content?.type === "text" && content.text ? JSON.parse(content.text) : null;
      const bareSvg: string | undefined = data?.svg;
      if (!bareSvg) throw new Error("No se pudo obtener el icono.");

      const orphanId = createOrphanId();
      const html = bareSvg.replace(/^<svg /, `<svg data-layer-id="${orphanId}" data-layer-name="${icon.name}" `);
      const css = `[data-layer-id="${orphanId}"] {\n  position: absolute;\n  left: 0;\n  top: 0;\n  width: ${icon.size}px;\n  height: ${icon.size}px;\n  overflow: visible;\n}`;
      const position = worldPos || findCanvasObjectPosition(frames, canvasObjectsRef.current);
      const newOrphan: HtmlCanvasObject = {
        id: orphanId, name: icon.name, kind: "shape", frameId: null,
        html, css,
        x: Math.round(position.x), y: Math.round(position.y),
        width: icon.size, height: icon.size,
        zIndex: canvasObjectsRef.current.length + frames.length,
      };
      commitCanvasObjects([...canvasObjectsRef.current, newOrphan]);
      setSelectedOrphanIds(new Set([orphanId]));
      setIconInsertError("");
      addToast("✓ Icono insertado", "success");
    } catch (e: any) {
      setIconInsertError(e?.message || "No se pudo insertar el icono.");
    }
  }, [frames, commitCanvasObjects, addToast]);

  // Click (no explicit canvas position): into the selected frame at a fixed
  // default offset, or as an orphan wherever findCanvasObjectPosition finds
  // free space if nothing's selected.
  const handleInsertIconClick = useCallback((icon: IconPayload) => {
    if (selectedFrameId) insertIconIntoFrame(icon, selectedFrameId, 50, 50);
    else insertIconAsOrphan(icon);
  }, [selectedFrameId, insertIconIntoFrame, insertIconAsOrphan]);

  // Drag-and-drop: InfiniteHtmlCanvas already resolved the drop point
  // through its own pan/zoom transform and frame hit-test.
  const handleIconDropOnCanvas = useCallback((icon: IconPayload, x: number, y: number, frameId: string | null) => {
    if (frameId) insertIconIntoFrame(icon, frameId, x, y);
    else insertIconAsOrphan(icon, { x, y });
  }, [insertIconIntoFrame, insertIconAsOrphan]);

  // Illustrations (unDraw) — same real-SVG-as-a-vector-layer treatment as
  // icons, just much larger, so they're scaled to fit a sane canvas size
  // while preserving aspect ratio.
  const handleInsertIllustration = useCallback(async (ill: IllustrationPayload) => {
    try {
      const res = await apiFetch<any>("/mcp", {
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", method: "get_illustration_svg", params: { slug: ill.slug }, id: 1 }),
      });
      if (res?.error) throw new Error(res.error.message);
      const content = res?.result?.content?.[0];
      const data = content?.type === "text" && content.text ? JSON.parse(content.text) : null;
      if (!data?.svg) throw new Error("No se pudo obtener la ilustración.");

      const scale = Math.min(1, 480 / (data.width || 800));
      const w = Math.round((data.width || 800) * scale);
      const h = Math.round((data.height || 600) * scale);
      const orphanId = createOrphanId();
      const html = String(data.svg).replace(/^<svg /, `<svg data-layer-id="${orphanId}" data-layer-name="${ill.title}" `);
      const css = `[data-layer-id="${orphanId}"] {\n  position: absolute;\n  left: 0;\n  top: 0;\n  width: ${w}px;\n  height: ${h}px;\n  overflow: visible;\n}`;
      const position = findCanvasObjectPosition(frames, canvasObjectsRef.current);
      const newOrphan: HtmlCanvasObject = {
        id: orphanId, name: ill.title, kind: "shape", frameId: null,
        html, css,
        x: Math.round(position.x), y: Math.round(position.y),
        width: w, height: h,
        zIndex: canvasObjectsRef.current.length + frames.length,
      };
      commitCanvasObjects([...canvasObjectsRef.current, newOrphan]);
      setSelectedOrphanIds(new Set([orphanId]));
      setIconInsertError("");
      addToast("✓ Ilustración insertada", "success");
    } catch (e: any) {
      setIconInsertError(e?.message || "No se pudo insertar la ilustración.");
    }
  }, [frames, commitCanvasObjects, addToast]);

  // Photos (Unsplash) — routed through the existing asset pipeline so the
  // image becomes a real owned asset in our own bucket rather than a hotlink
  // to Unsplash's CDN (which can rotate URLs), exactly like every other
  // image that enters the editor.
  const handleInsertPhoto = useCallback(async (photo: PhotoPayload) => {
    try {
      addToast("Descargando foto…", "info");
      const resp = await fetch(photo.url);
      const blob = await resp.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const uploaded = await apiFetch<{ url: string }>("/api/assets/upload", {
        method: "POST",
        body: JSON.stringify({
          // Unsplash's licence asks for photographer credit wherever the
          // photo is used — baking it into the asset name keeps it attached
          // to the file itself rather than living only in this one panel.
          name: `${photo.alt.slice(0, 40)} — © ${photo.credit.name} (Unsplash)`,
          data: dataUrl,
          workspaceId: templateWorkspaceId,
        }),
      });
      await handleAssetUploaded({ name: photo.alt || "Foto", url: uploaded.url, width: photo.width, height: photo.height });
      setIconInsertError("");
    } catch (e: any) {
      setIconInsertError(e?.message || "No se pudo insertar la foto.");
    }
  }, [templateWorkspaceId, handleAssetUploaded, addToast]);

  // Resolves the currently-selected image (a frame-based <img> layer or an
  // orphan canvas image object) into its URL plus canvas-space geometry.
  // Shared by convert-to-design and Nano Banana generation so both read the
  // exact same selection and can place their output relative to it.
  const resolveSelectedImage = useCallback((): {
    url: string; x: number; y: number; width: number; height: number;
  } | null => {
    if (selectedElement?.src) {
      const frame = frames.find(f => f.id === selectedElement.frameId);
      if (!frame) return null;
      const left = parseFloat(selectedElement.computedStyles.left) || 0;
      const top = parseFloat(selectedElement.computedStyles.top) || 0;
      const width = parseFloat(selectedElement.computedStyles.width) || 1080;
      const height = parseFloat(selectedElement.computedStyles.height) || 1080;
      return { url: selectedElement.src, x: frame.x + left, y: frame.y + top, width, height };
    }
    if (selectedOrphanIds.size === 1) {
      const obj = canvasObjects.find(o => selectedOrphanIds.has(o.id));
      if (!obj || obj.kind !== "image") return null;
      const url = obj.html.match(/src="([^"]+)"/)?.[1] || null;
      if (!url) return null;
      return { url, x: obj.x, y: obj.y, width: obj.width || 1080, height: obj.height || 1080 };
    }
    return null;
  }, [selectedElement, selectedOrphanIds, frames, canvasObjects]);

  // Convert the currently-selected image into an AI-replicated editable
  // design. Works the same whether the image lives on our own Supabase
  // bucket or is a remote/hyperlinked URL — either way it's just a fetchable
  // src. The result lands in a brand-new frame placed to the right of the
  // source image, so selecting-and-clicking feels like "make this editable"
  // rather than "upload something".
  const handleConvertSelectedImageToDesign = useCallback(async () => {
    const src = resolveSelectedImage();
    if (!src) { addToast("Selecciona una imagen en el editor primero.", "error"); return; }
    const { url: srcUrl, x: srcX, y: srcY, width: srcW, height: srcH } = src;

    setMcpLoading("imageToDesign");
    try {
      const resp = await fetch(srcUrl);
      if (!resp.ok) throw new Error(`No se pudo descargar la imagen (${resp.status})`);
      const blob = await resp.blob();
      const imageBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
        reader.readAsDataURL(blob);
      });

      const newFrame: FrameData = {
        id: createFrameId(),
        name: `Frame ${nextFrameNumber(frames)}`,
        x: Math.round(srcX + srcW + FRAME_GAP), y: Math.round(srcY),
        width: Math.round(srcW) || 1080, height: Math.round(srcH) || 1080,
        html: "", css: "",
        background: "#ffffff",
      };
      const updated = [...frames, newFrame];
      store.replaceAllWithUndo(updated, "edit");
      setSelectedFrameId(newFrame.id);
      setSelectedFrameIds(new Set([newFrame.id]));

      // Persist synchronously (bypassing the 2s-debounced autoSave) so the
      // server-side template already has this frame when image_to_design
      // looks it up by id.
      await apiFetch(`/api/templates/${templateId}`, {
        method: "PUT",
        body: JSON.stringify({
          frames: updated,
          canvasObjects: canvasObjectsRef.current,
          html: newFrame.html,
          css: newFrame.css,
          name: templateName,
        }),
      });

      addToast("🤖 Analizando imagen con IA...", "info");
      const res = await apiFetch<any>("/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "image_to_design",
          params: {
            templateId, imageBase64, frameId: newFrame.id,
            width: newFrame.width, height: newFrame.height,
            geminiModel,
          },
          id: 0,
        }),
      });
      // No key anywhere (neither the user's nor the server's) — open the
      // AI config panel in the right sidebar so the user can paste their
      // key without leaving the editor.
      if (res.error && String(res.error.message || "").includes("NO_GEMINI_KEY")) {
        setMcpLoading(null);
        addToast("Configurá tu API key de Gemini en el panel de la derecha.", "info");
        openAiConfigPanel();
        return;
      }
      if (res.error) throw new Error(res.error.message || "image_to_design falló");
      await reloadFromServer();
      addToast("✓ Diseño generado junto a la imagen original.", "success");
    } catch (err: any) {
      addToast(`No se pudo convertir la imagen: ${err?.message || "error desconocido"}`, "error");
    }
    setMcpLoading(null);
  }, [resolveSelectedImage, templateId, templateName, reloadFromServer, addToast, geminiModel, openAiConfigPanel]);

  // ── Nano Banana image generation (topbar 🍌) ──
  const [nbPrompt, setNbPrompt] = useState("");
  const [nbModel, setNbModel] = useState<string>(
    () => localStorage.getItem(NANO_BANANA_MODEL_SLOT) || NANO_BANANA_MODELS[0].id,
  );
  // Output format: "" = auto (the model decides), a preset id from
  // NANO_BANANA_ASPECTS, or "custom" whose W×H inputs snap to the nearest
  // supported ratio. Device-level only (localStorage), like the model slot.
  const [nbAspect, setNbAspect] = useState<string>(() => {
    try { return localStorage.getItem(NANO_BANANA_ASPECT_SLOT) || ""; } catch { return ""; }
  });
  const [nbCustomW, setNbCustomW] = useState("1920");
  const [nbCustomH, setNbCustomH] = useState("1080");
  // Fidelity controls: strict toggles the server-side anti-hallucination
  // charter (default on, edit mode only); "" temperature = Auto → the server
  // applies 0.25 on edits and the model default from scratch.
  const [nbStrict, setNbStrict] = useState<string>(() => {
    try { return localStorage.getItem(NANO_BANANA_STRICT_SLOT) ?? "1"; } catch { return "1"; }
  });
  const [nbTemp, setNbTemp] = useState<string>(() => {
    try { return localStorage.getItem(NANO_BANANA_TEMP_SLOT) || ""; } catch { return ""; }
  });
  // v36: the 🍌 model follows the account (same pref the Dashboard saves).
  // localStorage stays the fast path — the server only fills a blank device.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const prefs = await fetchUserPrefs();
        if (cancelled) return;
        const server = typeof prefs.nanoBananaModel === "string" ? prefs.nanoBananaModel : "";
        if (!server) return;
        try {
          if (localStorage.getItem(NANO_BANANA_MODEL_SLOT)) return;
          localStorage.setItem(NANO_BANANA_MODEL_SLOT, server);
        } catch { /* private mode */ }
        setNbModel(server);
      } catch { /* guest or offline */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // With an image selected it uses that image as the editing reference plus
  // the prompt as instructions; with nothing selected it generates from
  // scratch. The result is uploaded as a real owned asset and placed NEXT TO
  // the source image (never on top of it) — same placement rule as
  // convert-to-design.
  const handleGenerateNanoBanana = useCallback(async () => {
    const prompt = nbPrompt.trim();
    if (!prompt) { addToast("Escribí primero qué querés generar.", "error"); return; }
    if (!geminiConfigured) { addToast("Guardá tu API key de Gemini en el panel para generar.", "info"); return; }
    setMcpLoading("genImage");
    // Output format: custom W×H snaps to the nearest Gemini-supported ratio
    // (1350×1080 → 5:4, A4 → 2:3); "" sends no aspectRatio (model default).
    const cw = parseInt(nbCustomW, 10);
    const ch = parseInt(nbCustomH, 10);
    const aspect = nbAspect === "custom"
      ? (cw > 0 && ch > 0 ? nearestNanoBananaAspect(cw, ch) : undefined)
      : (nbAspect || undefined);
    const useStrict = nbStrict !== "0";
    const tempNum = nbTemp === "" ? undefined : Number(nbTemp);
    try {
      const src = resolveSelectedImage();
      let imageBase64: string | undefined;
      if (src) {
        const resp = await fetch(src.url);
        if (!resp.ok) throw new Error(`No se pudo descargar la imagen seleccionada (${resp.status})`);
        const blob = await resp.blob();
        imageBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
          reader.readAsDataURL(blob);
        });
      }

      addToast(imageBase64 ? "🍌 Editando la imagen con Nano Banana..." : "🍌 Generando imagen con Nano Banana...", "info");
      const res = await apiFetch<any>("/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "ai_generate_image",
          params: { prompt, model: nbModel, ...(aspect ? { aspectRatio: aspect } : {}), ...(useStrict ? {} : { strict: false }), ...(tempNum !== undefined && Number.isFinite(tempNum) ? { temperature: tempNum } : {}), ...(imageBase64 ? { imageBase64 } : {}) },
          id: 0,
        }),
      });
      if (res.error) throw new Error(res.error.message || "ai_generate_image falló");
      // JSON-RPC wrap: result.content[0].text carries the tool result JSON.
      const text = res.result?.content?.[0]?.text;
      const data = text ? JSON.parse(text) : res.result;
      if (!data?.imageBase64) throw new Error("La IA no devolvió ninguna imagen");

      // Real owned asset in our bucket (same pipeline as Unsplash photos) —
      // the canvas must never depend on a volatile data URI.
      const uploaded = await apiFetch<{ url: string }>("/api/assets/upload", {
        method: "POST",
        body: JSON.stringify({
          name: `Nano Banana — ${prompt.slice(0, 40)}`,
          data: data.imageBase64,
          workspaceId: templateWorkspaceId,
        }),
      });

      // Display size: always probe the generated natural size — the format
      // selector can change it vs the reference (1:1 source → 16:9 result)
      // — capped at 800px like any other upload.
      const dims = await new Promise<{ w: number; h: number }>((resolve) => {
        const probe = new Image();
        probe.onload = () => resolve({ w: probe.naturalWidth || 512, h: probe.naturalHeight || 512 });
        probe.onerror = () => resolve({ w: 512, h: 512 });
        probe.src = uploaded.url;
      });
      const scale = Math.min(1, 800 / dims.w, 800 / dims.h);
      const width = Math.max(1, Math.round(dims.w * scale));
      const height = Math.max(1, Math.round(dims.h * scale));

      // Place NEXT TO the reference image when there is one — never on top;
      // otherwise the standard auto-position for new canvas objects.
      const position = src
        ? { x: Math.round(src.x + src.width + FRAME_GAP), y: Math.round(src.y) }
        : findCanvasObjectPosition(frames, canvasObjectsRef.current);

      const layerId = createLayerId();
      const imageElement = document.createElement("img");
      imageElement.setAttribute("data-layer-id", layerId);
      imageElement.setAttribute("data-layer-name", "Nano Banana");
      imageElement.setAttribute("data-layer-kind", "image");
      imageElement.setAttribute("src", uploaded.url);
      imageElement.setAttribute("alt", `Nano Banana — ${prompt.slice(0, 60)}`);
      imageElement.setAttribute("draggable", "false");
      const html = imageElement.outerHTML;
      const css = `[data-layer-id="${layerId}"] {
  position: absolute;
  left: 0;
  top: 0;
  width: ${width}px;
  height: ${height}px;
  display: block;
  object-fit: contain;
}`;
      const object: HtmlCanvasObject = {
        id: layerId,
        name: `Nano Banana — ${prompt.slice(0, 24)}`,
        kind: "image",
        frameId: null,
        html,
        css,
        ...position,
        width,
        height,
        zIndex: frames.length + canvasObjectsRef.current.length,
      };
      commitCanvasObjects([...canvasObjectsRef.current, object]);
      handleSelectOrphan(object.id);
      addToast(src ? "✓ Imagen generada junto a la original." : "✓ Imagen generada.", "success");
    } catch (err: any) {
      const msg = String(err?.message || "error desconocido");
      if (msg.includes("NO_GEMINI_KEY")) {
        addToast("Falta tu API key de Gemini — guardala en el panel.", "info");
      } else {
        addToast(`No se pudo generar la imagen: ${msg}`, "error");
      }
    }
    setMcpLoading(null);
  }, [nbPrompt, nbModel, nbAspect, nbCustomW, nbCustomH, nbStrict, nbTemp, geminiConfigured, resolveSelectedImage, frames, commitCanvasObjects, handleSelectOrphan, addToast, templateWorkspaceId]);

  // ── Layer separation (Seedream 5.0 Pro via WaveSpeedAI, topbar 🧅) ──
  const [splitPrompt, setSplitPrompt] = useState("");
  const [splitModel, setSplitModel] = useState<string>(
    () => localStorage.getItem(LAYER_SPLIT_MODEL_SLOT) || LAYER_SPLIT_MODELS[0].id,
  );
  const [splitResolution, setSplitResolution] = useState<string>(() => {
    const saved = localStorage.getItem(LAYER_SPLIT_RES_SLOT);
    return ["1k", "1.5k", "2k"].includes(saved || "") ? saved! : "1k";
  });
  const [splitSpeed, setSplitSpeed] = useState<"fast" | "standard">(
    () => (localStorage.getItem(LAYER_SPLIT_SPEED_SLOT) === "standard" ? "standard" : "fast"),
  );
  const [splitStatus, setSplitStatus] = useState<"idle" | "submitting" | "processing" | "uploading">("idle");
  const [splitEtaLeft, setSplitEtaLeft] = useState(0);     // seconds to ETA (0 = overtime)
  const [splitNextCheck, setSplitNextCheck] = useState(0); // seconds to next status check
  const splitRunIdRef = useRef(0);
  // Leaving the editor kills any in-flight wait loop (the WaveSpeed task
  // itself keeps running server-side; we just stop watching it).
  useEffect(() => () => { splitRunIdRef.current++; }, []);

  const handleSeparateLayers = useCallback(async () => {
    const src = resolveSelectedImage();
    if (!src) { addToast("Seleccioná una imagen en el editor primero.", "error"); return; }
    if (!wavespeedConfigured) { addToast("Guardá tu API key de WaveSpeedAI en el panel.", "info"); return; }

    const runId = ++splitRunIdRef.current;
    const alive = () => splitRunIdRef.current === runId;
    const callSplit = (method: string, splitParams: Record<string, unknown>) =>
      apiFetch<any>("/mcp", {
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", method, params: splitParams, id: 0 }),
      }).then(res => {
        if (res.error) throw new Error(res.error.message || `${method} falló`);
        return JSON.parse(res.result?.content?.[0]?.text || "{}");
      });

    setSplitStatus("submitting");
    try {
      addToast("🧅 Enviando imagen a Seedream...", "info");
      const submitted = await callSplit("separate_image_layers", {
        imageUrl: src.url,
        ...(splitPrompt.trim() ? { prompt: splitPrompt.trim() } : {}),
        resolution: splitResolution,
        promptOptimizationMode: splitSpeed,
      });
      if (!alive()) return;
      const predictionId = submitted?.predictionId;
      if (!predictionId) throw new Error("El servidor no devolvió el id de la tarea");

      // The GPUs at WaveSpeed do the waiting — we never hold a server
      // connection open. Countdown ticks every second; real status checks
      // are spaced out (first at 30s, then every ~12s, both free).
      setSplitStatus("processing");
      const startedAt = Date.now();
      const deadline = startedAt + LAYER_SPLIT_MAX_MS;
      let nextCheckAt = startedAt + LAYER_SPLIT_FIRST_CHECK_MS;
      let outputs: string[] | null = null;
      let layersMeta: any[] | null = null;
      while (alive()) {
        await new Promise(r => setTimeout(r, 1000));
        if (!alive()) return;
        const elapsed = Date.now() - startedAt;
        setSplitEtaLeft(Math.max(0, Math.ceil((LAYER_SPLIT_ETA_MS - elapsed) / 1000)));
        setSplitNextCheck(Math.max(0, Math.ceil((nextCheckAt - Date.now()) / 1000)));
        if (Date.now() >= deadline) throw new Error("La separación tardó demasiado (más de 8 min) — la tarea sigue en WaveSpeed, pero dejamos de esperar.");
        if (Date.now() >= nextCheckAt) {
          nextCheckAt = Date.now() + LAYER_SPLIT_CHECK_EVERY_MS;
          const check = await callSplit("separate_image_layers_check", { predictionId });
          if (!alive()) return;
          if (check?.status === "completed" && Array.isArray(check.outputs)) {
            outputs = check.outputs;
            layersMeta = Array.isArray(check.layers) ? check.layers : null;
            break;
          }
        }
      }
      if (!alive()) return;
      if (!outputs || outputs.length === 0) throw new Error("Seedream no devolvió capas");
      // Full completion payload: per-layer names/sizes/bounding boxes when
      // WaveSpeed returns structured outputs, else empty (positions are
      // then recovered by visual matching below).
      const layerMeta: Array<{ url: string; name: string | null; size: string | null; boundingBox: any }> =
        Array.isArray(layersMeta) ? layersMeta : [];

      // Download every layer first and KEEP the blobs — placement may need
      // the pixels (visual matching) and the upload needs the data anyway.
      // WaveSpeed's URLs are not permanent storage; a saved design must
      // never depend on them.
      setSplitStatus("uploading");
      const downloaded: { url: string; blob: Blob }[] = [];
      for (let i = 0; i < outputs.length; i++) {
        const resp = await fetch(outputs[i]);
        if (!resp.ok) throw new Error(`No se pudo descargar la capa ${i + 1} (${resp.status})`);
        downloaded.push({ url: outputs[i], blob: await resp.blob() });
      }
      if (!alive()) return;

      // ---- Placement --------------------------------------------------------
      // Seedream returns the base as a full-canvas image and every element
      // as a tight transparent crop PLUS its bounding box on the canvas.
      // Rebuild the original composition: each layer sits at its exact rect
      // so the stack recomposes the source image while every element stays
      // individually selectable, movable and resizable.
      const frameW = Math.max(1, Math.round(src.width)) || 1080;
      const frameH = Math.max(1, Math.round(src.height)) || 1080;
      const baseSize = String(layerMeta[0]?.size || "").match(/^(\d+)x(\d+)$/);
      const canvasW = baseSize ? Number(baseSize[1]) : 0;
      const canvasH = baseSize ? Number(baseSize[2]) : 0;
      const rectFromBox = (box: any): { left: number; top: number; width: number; height: number } | null => {
        const n = Array.isArray(box?.normalized) && box.normalized.length === 4 ? box.normalized.map(Number) : null;
        const a = Array.isArray(box?.absolute) && box.absolute.length === 4 ? box.absolute.map(Number) : null;
        let x0 = 0, y0 = 0, x1 = 0, y1 = 0, ok = false;
        if (n && n.every(Number.isFinite)) { x0 = n[0] / 1000; y0 = n[1] / 1000; x1 = n[2] / 1000; y1 = n[3] / 1000; ok = true; }
        else if (a && a.every(Number.isFinite) && canvasW > 0 && canvasH > 0) { x0 = a[0] / canvasW; y0 = a[1] / canvasH; x1 = a[2] / canvasW; y1 = a[3] / canvasH; ok = true; }
        if (!ok || x1 <= x0 || y1 <= y0 || x0 < -0.01 || y0 < -0.01 || x1 > 1.01 || y1 > 1.01) return null;
        return {
          left: Math.round(x0 * frameW), top: Math.round(y0 * frameH),
          width: Math.max(1, Math.round((x1 - x0) * frameW)), height: Math.max(1, Math.round((y1 - y0) * frameH)),
        };
      };

      type Placement = { idx: number; name: string; left: number; top: number; width: number; height: number };
      const placed: Placement[] = [];
      const matched = new Set<number>();
      for (let i = 0; i < downloaded.length; i++) {
        const meta = layerMeta[i] || null;
        const name = meta?.name || (i === 0 ? "Capa base (fondo)" : `Capa ${i}`);
        // The first output is the documented base/background: full canvas
        // when it carries no bounding box.
        const rect = i === 0 && !meta?.boundingBox
          ? { left: 0, top: 0, width: frameW, height: frameH }
          : rectFromBox(meta?.boundingBox);
        if (rect) { placed.push({ idx: i, name, ...rect }); matched.add(i); }
      }

      // Layers without metadata (WaveSpeed returned plain URLs): recover
      // their spot with masked template matching against the source image.
      const unmatched = downloaded.map((_, i) => i).filter(i => !matched.has(i) && i !== 0);
      if (unmatched.length > 0) {
        addToast(`📍 Ubicando ${unmatched.length} capa(s) por coincidencia visual…`, "info");
        for (const i of unmatched) {
          let hit: LayerHit | null = null;
          try { hit = await locateLayerInImage(src.url, downloaded[i].blob); } catch { hit = null; }
          if (!alive()) return;
          if (hit) {
            placed.push({
              idx: i,
              name: layerMeta[i]?.name || `Capa ${i}`,
              left: Math.round(hit.left * frameW), top: Math.round(hit.top * frameH),
              width: Math.max(1, Math.round(hit.width * frameW)), height: Math.max(1, Math.round(hit.height * frameH)),
            });
            matched.add(i);
          }
        }
      }
      // The base never goes to the loose row — it IS the canvas.
      if (!matched.has(0)) { placed.push({ idx: 0, name: layerMeta[0]?.name || "Capa base (fondo)", left: 0, top: 0, width: frameW, height: frameH }); }
      placed.sort((p, q) => p.idx - q.idx); // HTML order = stacking order

      // ---- Upload to our own bucket -----------------------------------------
      const assetUrl = new Map<number, string>();
      for (let i = 0; i < downloaded.length; i++) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error("No se pudo leer la capa"));
          reader.readAsDataURL(downloaded[i].blob);
        });
        const label = placed.find(p => p.idx === i)?.name
          ?? (layerMeta[i]?.name ? `Capa suelta (${layerMeta[i]?.name})` : `Capa suelta ${i}`);
        const up = await apiFetch<{ url: string }>("/api/assets/upload", {
          method: "POST",
          body: JSON.stringify({
            name: `${label} — ${templateName}`,
            data: dataUrl,
            workspaceId: templateWorkspaceId,
          }),
        });
        assetUrl.set(i, up.url);
      }
      if (!alive()) return;

      // ---- Frames ------------------------------------------------------------
      // Layered frame NEXT TO the source image (never on top): base at 0,0
      // full size, each element at its exact rect — the stack recomposes the
      // original pixel-for-pixel while staying individually editable.
      const layerIds = placed.map(() => createLayerId());
      const html = placed.map((p, k) => {
        const el = document.createElement("img");
        el.setAttribute("data-layer-id", layerIds[k]);
        el.setAttribute("data-layer-name", p.name);
        el.setAttribute("data-layer-kind", "image");
        el.setAttribute("src", assetUrl.get(p.idx) || "");
        el.setAttribute("alt", p.name);
        el.setAttribute("draggable", "false");
        return el.outerHTML;
      }).join("\n");
      const css = layerIds.map((id, k) => `[data-layer-id="${id}"] {
  position: absolute;
  left: ${placed[k].left}px;
  top: ${placed[k].top}px;
  width: ${placed[k].width}px;
  height: ${placed[k].height}px;
  display: block;
  object-fit: fill;
}`).join("\n\n");
      const newFrame: FrameData = {
        id: createFrameId(),
        name: `Capas ${nextFrameNumber(frames)}`,
        x: Math.round(src.x + src.width + FRAME_GAP),
        y: Math.round(src.y),
        width: frameW,
        height: frameH,
        html,
        css,
        background: "transparent",
      };

      // Layers without a confident location become small standalone frames
      // in a row BELOW the composition — never stretched, never stacked.
      const looseIdx = downloaded.map((_, i) => i).filter(i => !matched.has(i));
      const looseFrames: FrameData[] = [];
      let looseX = Math.round(src.x);
      const looseY = Math.round(src.y + src.height + 80);
      for (const i of looseIdx) {
        let aspect = 1;
        try { aspect = await blobAspect(downloaded[i].blob); } catch { /* keep 1:1 */ }
        const w = Math.min(480, Math.max(40, Math.round(200 * aspect)));
        looseFrames.push({
          id: createFrameId(),
          name: `Capa suelta — ${layerMeta[i]?.name || `Capa ${i}`}`,
          x: looseX,
          y: looseY,
          width: w,
          height: 200,
          html: `<img data-layer-id="${createLayerId()}" data-layer-name="Capa suelta" data-layer-kind="image" src="${assetUrl.get(i) || ""}" alt="Capa suelta" draggable="false" />`,
          css: `img {\n  width: 100%;\n  height: 100%;\n  object-fit: contain;\n  display: block;\n}`,
          background: "transparent",
        });
        looseX += w + 24;
      }

      const updated = [...frames, newFrame, ...looseFrames];
      store.replaceAllWithUndo(updated, "edit");
      setSelectedFrameId(newFrame.id);
      setSelectedFrameIds(new Set([newFrame.id]));
      autoSave(updated);
      const looseNote = looseIdx.length > 0 ? ` — ${looseIdx.length} sin posición confiable quedaron como assets abajo.` : "";
      addToast(`✓ ${placed.length} capa${placed.length === 1 ? "" : "s"} en su posición y tamaño exactos${looseNote}`, "success");
    } catch (err: any) {
      const msg = String(err?.message || "error desconocido");
      if (msg.includes("NO_WAVESPEED_KEY")) {
        addToast("Falta tu API key de WaveSpeedAI — guardala en el panel.", "info");
      } else {
        addToast(`No se pudo separar en capas: ${msg}`, "error");
      }
    }
    if (alive()) setSplitStatus("idle");
  }, [splitPrompt, splitResolution, splitSpeed, wavespeedConfigured, resolveSelectedImage, frames, templateName, templateWorkspaceId, autoSave, addToast]);

  // ── Image → video (RunwayML Gen-4, topbar 🎬) ──
  const [videoPrompt, setVideoPrompt] = useState("");
  const [videoModel, setVideoModel] = useState<string>(
    () => localStorage.getItem(VIDEO_GEN_MODEL_SLOT) || VIDEO_GEN_MODELS[0].id,
  );
  const [videoRatio, setVideoRatio] = useState<string>(() => {
    const saved = localStorage.getItem(VIDEO_GEN_RATIO_SLOT);
    return VIDEO_GEN_RATIOS.some(r => r.id === saved) ? saved! : VIDEO_GEN_RATIOS[0].id;
  });
  const [videoDuration, setVideoDuration] = useState<number>(5);
  // image = animate a selected image; text = prompt-only generation.
  const [videoMode, setVideoMode] = useState<"image" | "text">("image");
  const [videoStatus, setVideoStatus] = useState<"idle" | "submitting" | "processing" | "saving">("idle");
  const [videoEtaLeft, setVideoEtaLeft] = useState(0);     // seconds to ETA (0 = overtime)
  const [videoNextCheck, setVideoNextCheck] = useState(0); // seconds to next status check
  const [videoResult, setVideoResult] = useState<{ url: string; name: string } | null>(null);
  const videoRunIdRef = useRef(0);
  // Leaving the editor kills any in-flight wait loop (the Runway task
  // itself keeps running server-side; we just stop watching it).
  useEffect(() => () => { videoRunIdRef.current++; }, []);

  const handleGenerateVideo = useCallback(async () => {
    const src = resolveSelectedImage();
    if (videoMode === "image" && !src) { addToast("Seleccioná una imagen en el editor primero.", "error"); return; }
    if (videoMode === "text" && !videoPrompt.trim()) { addToast("Escribí un prompt describiendo la escena completa.", "error"); return; }
    if (!runwayConfigured) { addToast("Guardá tu API key de RunwayML en el panel.", "info"); return; }

    const runId = ++videoRunIdRef.current;
    const alive = () => videoRunIdRef.current === runId;
    const callVideo = (method: string, videoParams: Record<string, unknown>) =>
      apiFetch<any>("/mcp", {
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", method, params: videoParams, id: 0 }),
      }).then(res => {
        if (res.error) throw new Error(res.error.message || `${method} falló`);
        return JSON.parse(res.result?.content?.[0]?.text || "{}");
      });

    setVideoStatus("submitting");
    setVideoResult(null);
    try {
      addToast("🎬 Enviando a Runway...", "info");
      const submitTool = videoMode === "text" ? "generate_text_video" : "generate_image_video";
      const submitParams = videoMode === "text"
        ? { prompt: videoPrompt.trim(), model: videoModel, duration: videoDuration, ratio: videoRatio }
        : { imageUrl: src!.url, ...(videoPrompt.trim() ? { prompt: videoPrompt.trim() } : {}), model: videoModel, duration: videoDuration, ratio: videoRatio };
      const submitted = await callVideo(submitTool, submitParams);
      if (!alive()) return;
      let taskId = submitted?.taskId;
      if (!taskId) throw new Error("El servidor no devolvió el id de la tarea");
      // Submit visibility: what Runway actually received (transport + input
      // shape), so any later failure can be correlated in console.
      console.error("[videoGen] submit:", {
        taskId, ephemeral: submitted?.ephemeral, ephemeralError: submitted?.ephemeralError,
        input: submitted?.input, promptImage: submitted?.promptImage,
      });

      // The GPUs at Runway do the waiting — we never hold a server
      // connection open. Countdown ticks every second; real status checks
      // are spaced out (first at 20s, then every ~10s, both free). A
      // transient check failure (429/5xx blip, platform 502) counts as a
      // strike — up to 5 in a row — instead of killing the whole wait:
      // the task keeps running on Runway either way.
      setVideoStatus("processing");
      let startedAt = Date.now();
      let deadline = startedAt + VIDEO_GEN_MAX_MS;
      let nextCheckAt = startedAt + VIDEO_GEN_FIRST_CHECK_MS;
      let videoUrl: string | null = null;
      let persistent = true;
      let tempUrl: string | null = null;
      const MAX_POLL_STRIKES = 5;
      let strikes = 0;
      let warnedUnstable = false;
      let retriedRunway = false;
      while (alive() && !tempUrl) {
        await new Promise(r => setTimeout(r, 1000));
        if (!alive()) return;
        const elapsed = Date.now() - startedAt;
        setVideoEtaLeft(Math.max(0, Math.ceil((VIDEO_GEN_ETA_MS - elapsed) / 1000)));
        setVideoNextCheck(Math.max(0, Math.ceil((nextCheckAt - Date.now()) / 1000)));
        if (Date.now() >= deadline) throw new Error("La generación tardó demasiado (más de 10 min) — la tarea sigue en Runway, pero dejamos de esperar.");
        if (Date.now() >= nextCheckAt) {
          nextCheckAt = Date.now() + VIDEO_GEN_CHECK_EVERY_MS;
          let check: any = null;
          let pollFailed: unknown = null;
          try {
            check = await callVideo("generate_image_video_check", { taskId, workspaceId: templateWorkspaceId });
          } catch (err) {
            pollFailed = err;
          }
          if (!alive()) return;
          if (pollFailed) {
            const msg = String((pollFailed as any)?.message || pollFailed);
            // Terminal causes abort immediately. Exception: Runway's generic
            // "unexpected error" FAILED is their documented transient GPU
            // glitch — their own troubleshooting says retry — so we silently
            // resubmit ONCE (each attempt costs credits, never more than one
            // automatic retry). Anything else keeps counting as a strike.
            if (msg.includes("NO_RUNWAY_KEY") || msg.includes("generation CANCELLED")) throw pollFailed;
            if (msg.includes("generation FAILED")) {
              // INTERNAL.BAD_OUTPUT = Runway's quality system rejected the
              // output — logos/watermarks/overlaid text in the image are the
              // documented #1 cause. Deterministic per their docs: an
              // identical resubmit just burns another ~76s, so abort with
              // actionable guidance instead of auto-retrying.
              if (/INTERNAL\.BAD_OUTPUT/.test(msg)) throw pollFailed;
              if (!retriedRunway && /unexpected error/i.test(msg)) {
                retriedRunway = true;
                addToast("Runway falló sin causa específica (glitch transitorio de su lado) — reintentando una vez…", "info");
                try {
                  const resubmitted = await callVideo(submitTool, submitParams);
                  if (!alive()) return;
                  const newTaskId = resubmitted?.taskId;
                  if (!newTaskId) throw new Error("resubmit sin taskId");
                  console.error(`[videoGen] FAILED genérico — reintento como tarea ${newTaskId}`, {
                    ephemeral: resubmitted?.ephemeral, ephemeralError: resubmitted?.ephemeralError, input: resubmitted?.input,
                  });
                  taskId = newTaskId;
                  strikes = 0;
                  startedAt = Date.now();
                  deadline = startedAt + VIDEO_GEN_MAX_MS;
                  nextCheckAt = startedAt + VIDEO_GEN_FIRST_CHECK_MS;
                } catch (resubmitErr) {
                  console.error("[videoGen] resubmit failed:", resubmitErr);
                  throw pollFailed;
                }
              } else {
                throw pollFailed;
              }
            } else {
              strikes++;
              console.error(`[videoGen] status check ${strikes}/${MAX_POLL_STRIKES} failed:`, msg);
              if (strikes >= 3 && !warnedUnstable) { warnedUnstable = true; addToast("Conexión inestable con Runway — seguimos reintentando…", "info"); }
              if (strikes >= MAX_POLL_STRIKES) throw new Error(`Se perdieron ${MAX_POLL_STRIKES} chequeos seguidos — la tarea sigue en Runway (id ${taskId}), pero dejamos de esperar. (${msg})`);
            }
          } else if (check?.status === "POLL_ERROR") {
            strikes++;
            console.error(`[videoGen] transient poll ${strikes}/${MAX_POLL_STRIKES}:`, check.message);
            if (strikes >= 3 && !warnedUnstable) { warnedUnstable = true; addToast("Conexión inestable con Runway — seguimos reintentando…", "info"); }
            if (strikes >= MAX_POLL_STRIKES) throw new Error(`Se perdieron ${MAX_POLL_STRIKES} chequeos seguidos — la tarea sigue en Runway (id ${taskId}), pero dejamos de esperar.`);
          } else {
            strikes = 0;
            if (check?.status === "SUCCEEDED" && check.tempUrl) {
              tempUrl = check.tempUrl;
            }
          }
        }
      }
      if (!alive()) return;

      // Persist phase: re-upload the finished mp4 in its own bounded server
      // call, with one retry. A persistence hiccup must never discard an
      // already-paid generation — fall back to the temporary URL.
      if (tempUrl && !videoUrl) {
        setVideoStatus("saving");
        for (let attempt = 1; attempt <= 2 && alive(); attempt++) {
          try {
            const saved = await callVideo("generate_image_video_check", { taskId, persist: true, tempUrl, workspaceId: templateWorkspaceId });
            if (!alive()) return;
            if (saved?.videoUrl) {
              videoUrl = saved.videoUrl;
              persistent = saved.persistent !== false;
              break;
            }
          } catch (err) {
            if (!alive()) return;
            console.error(`[videoGen] persist attempt ${attempt}/2 failed:`, err);
            if (attempt < 2) await new Promise(r => setTimeout(r, 2500));
          }
        }
        if (!videoUrl) { videoUrl = tempUrl; persistent = false; }
      }
      if (!alive()) return;
      if (!videoUrl) throw new Error("Runway no devolvió el video");

      // Video frame NEXT TO the source image (never on top). The <video>
      // layer carries the source image as poster so thumbnails/exports
      // (which can't capture playback) still show a meaningful frame.
      setVideoStatus("saving");
      const [rw, rh] = videoRatio.split(":").map(Number);
      const frameW = rw || 1280;
      const frameH = rh || 720;
      const layerId = createLayerId();
      const videoName = `Video ${nextFrameNumber(frames)}`;
      const videoElement = document.createElement("video");
      videoElement.setAttribute("data-layer-id", layerId);
      videoElement.setAttribute("data-layer-name", videoName);
      videoElement.setAttribute("data-layer-kind", "video");
      videoElement.setAttribute("src", videoUrl);
      if (src) videoElement.setAttribute("poster", src.url);
      videoElement.setAttribute("controls", "");
      videoElement.setAttribute("muted", "");
      videoElement.setAttribute("loop", "");
      videoElement.setAttribute("playsinline", "");
      videoElement.setAttribute("preload", "metadata");
      videoElement.setAttribute("draggable", "false");
      const html = videoElement.outerHTML;
      const css = `[data-layer-id="${layerId}"] {
  position: absolute;
  left: 0;
  top: 0;
  width: ${frameW}px;
  height: ${frameH}px;
  display: block;
  object-fit: contain;
}`;
      // Image mode places the video NEXT TO its source; text mode has no
      // source, so it goes next to the last frame on canvas (or the origin).
      const lastFrame = frames[frames.length - 1];
      const newFrame: FrameData = {
        id: createFrameId(),
        name: videoName,
        x: Math.round(src ? src.x + src.width + FRAME_GAP : lastFrame ? lastFrame.x + lastFrame.width + FRAME_GAP : 0),
        y: Math.round(src ? src.y : lastFrame ? lastFrame.y : 0),
        width: frameW,
        height: frameH,
        html,
        css,
        background: "transparent",
      };
      const updated = [...frames, newFrame];
      store.replaceAllWithUndo(updated, "edit");
      setSelectedFrameId(newFrame.id);
      setSelectedFrameIds(new Set([newFrame.id]));
      autoSave(updated);
      setVideoResult({ url: videoUrl, name: `runway-${Date.now().toString(36)}.mp4` });
      addToast(persistent
        ? "✓ Video generado junto a la imagen — reproducilo o descargalo como mp4."
        : "✓ Video generado (URL temporaria — descargalo pronto, no se pudo guardar en tu biblioteca).", persistent ? "success" : "info");
    } catch (err: any) {
      console.error("[videoGen] generation failed:", err);
      const msg = String(err?.message || "error desconocido");
      if (msg.includes("NO_RUNWAY_KEY")) {
        addToast("Falta tu API key de RunwayML — guardala en el panel.", "info");
      } else if (/INTERNAL\.BAD_OUTPUT/.test(msg)) {
        addToast("Runway rechazó el resultado por calidad: la causa nº1 (documentada) es logos, marcas de agua o texto superpuesto en la imagen. Probá con una imagen limpia sin texto.", "error");
      } else if (/SAFETY\./.test(msg)) {
        addToast("Runway rechazó el contenido por moderación (entrada o salida) — cambiá la imagen o el prompt antes de reintentar.", "error");
      } else {
        addToast(`No se pudo generar el video: ${msg}`, "error");
      }
    }
    if (alive()) setVideoStatus("idle");
  }, [videoMode, videoPrompt, videoModel, videoRatio, videoDuration, runwayConfigured, resolveSelectedImage, frames, templateWorkspaceId, autoSave, addToast]);

  /** Cross-origin-safe mp4 download — the bucket/Runway URL never honors
   *  the download attribute from another origin, so we ferry it through a
   *  Blob and trigger the save locally. */
  const handleDownloadVideo = useCallback(async (url: string, name: string) => {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`${resp.status}`);
      const blob = await resp.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
    } catch (err: any) {
      addToast(`No se pudo descargar el mp4: ${err?.message || err}`, "error");
    }
  }, [addToast]);

  /** Vectorize the selected image to SVG via Quiver AI with live streaming.
   *  Shows a floating preview panel with the SVG building in real-time from
   *  draft events, then inserts the final SVG as a vector layer. */
  const handleVectorizeSelectedImage = useCallback(async () => {
    if (!quiverConfigured) {
      addToast("Configurá tu API key de Quiver AI en el panel de la derecha.", "info");
      openAiConfigPanel();
      return;
    }

    // Resolve the source image
    let srcUrl: string | null = null;
    let srcX = 0, srcY = 0;

    if (selectedElement?.src) {
      srcUrl = selectedElement.src;
    } else if (selectedOrphanIds.size === 1) {
      const obj = canvasObjects.find(o => selectedOrphanIds.has(o.id));
      if (!obj || obj.kind !== "image") { addToast("Selecciona una imagen primero.", "error"); return; }
      srcUrl = obj.html.match(/src="([^"]+)"/)?.[1] || null;
      srcX = obj.x; srcY = obj.y;
    } else {
      addToast("Selecciona una imagen en el editor primero.", "error");
      return;
    }
    if (!srcUrl) { addToast("La imagen seleccionada no tiene una fuente válida.", "error"); return; }

    setVectorizeLoading(true);
    setVectorizePreview(null);
    setVectorizeReasoning("");

    try {
      const resp = await fetch(srcUrl);
      const blob = await resp.blob();

      let imageBase64: string;

      if (cropMode === "manual" && cropRegion) {
        // Crop the image to the selected region using a canvas
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const url = URL.createObjectURL(blob);
          const el = new Image();
          el.onload = () => { resolve(el); };
          el.onerror = reject;
          el.src = url;
        });
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(cropRegion.w);
        canvas.height = Math.round(cropRegion.h);
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, cropRegion.x, cropRegion.y, cropRegion.w, cropRegion.h, 0, 0, canvas.width, canvas.height);
        imageBase64 = canvas.toDataURL("image/png");
      } else {
        // Auto-crop: send the full image, let Quiver detect the subject
        imageBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
          reader.readAsDataURL(blob);
        });
      }
      // Strip the data URL prefix ("data:image/png;base64,") — Quiver
      // expects raw base64 and rejects data URLs with 400 invalid_base64.
      imageBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");

      addToast("✦ Vectorizando con Quiver AI...", "info");

      const controller = streamVectorize(
        {
          imageBase64,
          autoCrop: cropMode === "auto",
          model: quiverModel,
        },
        {
          onEvent: (event: QuiverEvent) => {
            if (event.type === "reasoning") {
              setVectorizeReasoning(event.reasoning);
            } else if (event.type === "draft") {
              setVectorizePreview(event.svg);
            } else if (event.type === "content") {
              // Final SVG — insert as a vector layer
              setVectorizePreview(event.svg);
              const layerId = `quiver_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
              const wrappedSvg = event.svg.replace(
                /<svg/,
                `<svg data-layer-id="${layerId}" data-layer-kind="svg" data-layer-name="quiver-vector" style="position:absolute;left:${Math.round(srcX)}px;top:${Math.round(srcY)}px;"`,
              );

              const targetFrame = selectedElement?.frameId
                ? frames.find(f => f.id === selectedElement.frameId)
                : frames.find(f => f.id === selectedFrameId);

              if (targetFrame) {
                const updatedHtml = (targetFrame.html || "") + wrappedSvg;
                const updatedFrames = frames.map(f =>
                  f.id === targetFrame.id ? { ...f, html: updatedHtml } : f,
                );
                store.replaceAllWithUndo(updatedFrames, "edit");
                addToast("✓ SVG vectorizado insertado como capa editable.", "success");
              }
            }
          },
          onError: (err: Error) => {
            addToast(`Error de vectorización: ${err.message}`, "error");
            setVectorizeLoading(false);
          },
          onClose: () => {
            setVectorizeLoading(false);
          },
        },
      );
      quiverAbortRef.current = controller;
    } catch (err: any) {
      addToast(`No se pudo vectorizar: ${err?.message || "error desconocido"}`, "error");
      setVectorizeLoading(false);
    }
  }, [selectedElement, selectedOrphanIds, canvasObjects, frames, selectedFrameId, quiverConfigured, quiverModel, cropMode, cropRegion, store, addToast, openAiConfigPanel]);

  /** Buscatrazos local (REQ-043 Fase 1): traza la imagen seleccionada en el
   *  navegador (worker, sin IA ni red) con el preset elegido e inserta el
   *  resultado como capa SVG editable — el mismo convenio que la vía Quiver. */
  const handleTraceSelectedImage = useCallback(async (preset: string) => {
    if (traceBusy) return;
    // Resuelve la imagen origen — misma regla que la vía Quiver.
    let srcUrl: string | null = null;
    let srcX = 0;
    let srcY = 0;
    if (selectedElement?.src) {
      srcUrl = selectedElement.src;
    } else if (selectedOrphanIds.size === 1) {
      const obj = canvasObjects.find(o => selectedOrphanIds.has(o.id));
      if (!obj || obj.kind !== "image") { addToast("Selecciona una imagen primero.", "error"); return; }
      srcUrl = obj.html.match(/src="([^"]+)"/)?.[1] || null;
      srcX = obj.x;
      srcY = obj.y;
    } else {
      addToast("Selecciona una imagen en el editor primero.", "error");
      return;
    }
    if (!srcUrl) { addToast("La imagen seleccionada no tiene una fuente válida.", "error"); return; }
    setTraceBusy(true);
    traceCancelRef.current = { aborted: false };
    try {
      // El navegador decodifica cualquier raster nativamente; se reduce a
      // ≤ 4 MP antes de trazar para mantener el worker fluido.
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.crossOrigin = "anonymous";
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("No se pudo cargar la imagen (¿CORS?)"));
        el.src = srcUrl!;
      });
      const natural = img.naturalWidth * img.naturalHeight;
      const scale = natural > 4_000_000 ? Math.sqrt(4_000_000 / natural) : 1;
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0, w, h);
      const raster = { width: w, height: h, rgba: ctx.getImageData(0, 0, w, h).data };
      const params = tracePresetByName(preset) ?? defaultTraceParams();
      addToast(`Buscatrazos local (${preset})…`, "info");
      const outcome = await traceRaster(raster, params, { signal: traceCancelRef.current });
      if (!outcome.ok) {
        if (outcome.failure.code !== "cancelled") {
          addToast(`Buscatrazos: ${outcome.failure.message}`, "error");
        }
        return;
      }
      const result = outcome.result;
      const layerId = `trace_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const wrappedSvg = `<svg data-layer-id="${layerId}" data-layer-kind="svg" data-layer-name="Buscatrazos" viewBox="0 0 ${w} ${h}" style="position:absolute;left:${Math.round(srcX)}px;top:${Math.round(srcY)}px;width:${img.naturalWidth}px;height:${img.naturalHeight}px;overflow:visible;">${traceResultPathsMarkup(result)}</svg>`;
      const targetFrame = selectedElement?.frameId
        ? frames.find(f => f.id === selectedElement.frameId)
        : frames.find(f => f.id === selectedFrameId);
      if (targetFrame) {
        const updatedHtml = (targetFrame.html || "") + wrappedSvg;
        const updatedFrames = frames.map(f => (f.id === targetFrame.id ? { ...f, html: updatedHtml } : f));
        store.replaceAllWithUndo(updatedFrames, "edit");
        // REQ-049 B3: sin este autoSave la capa "Buscatrazos" desaparecía al
        // refrescar (mismo convenio que handleBatchGenerate).
        autoSave(updatedFrames);
      }
      addToast(`✓ ${result.paths.length} trazas, ${result.anchorCount} anclas — vectorizado local, sin IA.`, "success");
    } catch (err: any) {
      addToast(`No se pudo trazar: ${err?.message || "error desconocido"}`, "error");
    } finally {
      setTraceBusy(false);
    }
  }, [selectedElement, selectedOrphanIds, canvasObjects, frames, selectedFrameId, store, addToast, traceBusy, autoSave]);

  // Batchamator commits its generated duplicates the same way any other
  // frame-adding action does — append + undo-tracked + autosaved.
  const handleBatchGenerate = useCallback((updatedFrames: FrameData[]) => {
    store.replaceAllWithUndo(updatedFrames, "edit");
    autoSave(updatedFrames);
  }, [autoSave]);

  // Opens the Batchamator panel, seeding its checklist from whatever's
  // selected on canvas right now — but only when actually opening it (not
  // when it's already the active tab), so re-clicking doesn't clobber a
  // checklist the user built up manually.
  const openBatchPanel = useCallback(() => {
    if (showRightPanel && rightPanelTab === "batch") {
      setShowRightPanel(false);
      return;
    }
    setBatchCheckedFrameIds(selectedFrameIds.size > 0 ? new Set(selectedFrameIds) : new Set(selectedFrameId ? [selectedFrameId] : []));
    setRightPanelTab("batch");
    setShowRightPanel(true);
  }, [showRightPanel, rightPanelTab, selectedFrameIds, selectedFrameId]);

  // Scans a frame's HTML for <img> tags and uploads each distinct src as a
  // Workspace Asset — data: URLs go straight through, http(s) URLs (e.g. an
  // AI-placed image) are fetched and re-uploaded so they land in our own
  // storage, same approach as AssetsPanel's "save selection as asset".
  // Used by the Batchamator "Content Machine" flow to auto-capture any
  // logo/photo/pattern already sitting in the chosen frame.
  const saveFrameImagesAsAssets = useCallback(async (frame: FrameData): Promise<number> => {
    if (!frame.html) return 0;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = frame.html;
    const imgs = Array.from(wrapper.querySelectorAll("img"));
    const seen = new Set<string>();
    let saved = 0;
    for (const img of imgs) {
      const src = img.getAttribute("src");
      if (!src || seen.has(src)) continue;
      seen.add(src);
      try {
        let dataUrl = src;
        if (!dataUrl.startsWith("data:")) {
          const resp = await fetch(src);
          const blob = await resp.blob();
          if (!blob.type.startsWith("image/")) continue;
          dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        }
        const name = img.getAttribute("data-layer-name") || img.getAttribute("alt") || `Asset ${saved + 1}`;
        await apiFetch("/api/assets/upload", {
          method: "POST",
          body: JSON.stringify({ name, data: dataUrl, workspaceId: templateWorkspaceId }),
        });
        saved++;
      } catch (e) {
        console.error("[Content Machine] No se pudo guardar la imagen como asset:", e);
      }
    }
    return saved;
  }, [templateWorkspaceId]);

  // ── Batchamator ▸ Content Machine ──
  // 1) guarda el frame elegido como Key Visual, 2) guarda cualquier png/jpg
  // que contenga como Asset, 3) abre el panel de Batchamator (CSV) ya listo
  // para exportar/rellenar/resubir sobre ese mismo frame.
  const handleContentMachine = useCallback(async () => {
    setShowBatchMenu(false);
    const ids = selectedFrameIds.size > 0 ? selectedFrameIds : new Set(selectedFrameId ? [selectedFrameId] : []);
    const targetFrames = frames.filter(f => ids.has(f.id));
    if (targetFrames.length === 0) {
      addToast("Selecciona un frame primero.", "error");
      return;
    }
    await handleSaveRecipe();
    let totalAssets = 0;
    for (const f of targetFrames) {
      totalAssets += await saveFrameImagesAsAssets(f);
    }
    if (totalAssets > 0) {
      addToast(`✓ ${totalAssets} imagen${totalAssets === 1 ? "" : "es"} guardada${totalAssets === 1 ? "" : "s"} como Asset.`, "success");
    }
    openBatchPanel();
  }, [selectedFrameIds, selectedFrameId, frames, handleSaveRecipe, saveFrameImagesAsAssets, openBatchPanel, addToast]);

  // ── Batchamator ▸ Brand Guidelines / Design System ──
  // Ambos toman el frame seleccionado (como "Logotipo" o como "inspiración",
  // según el caso), extraen tokens vía generate_design_artifacts (que ya
  // aplica el fallback a Inter cuando no hay tipografía) y lo guardan como
  // Style en la Biblioteca, con un nombre sugerido para que quede claro de
  // dónde salió.
  const handleCaptureStyleFromSelection = useCallback(async (suffix: string) => {
    setShowBatchMenu(false);
    const ids = selectedFrameIds.size > 0 ? selectedFrameIds : new Set(selectedFrameId ? [selectedFrameId] : []);
    if (ids.size === 0) {
      addToast("Selecciona uno o varios frames primero.", "error");
      return;
    }
    const suggestedName = `${(templateName || "Marca").trim()}_${suffix}`;
    const ok = await handlePublishStyle(suggestedName);
    if (ok) {
      setRightPanelTab("styleLibrary");
      setShowRightPanel(true);
    }
  }, [selectedFrameIds, selectedFrameId, templateName, handlePublishStyle]);

  const handleBrandGuidelinesCapture = useCallback(() => handleCaptureStyleFromSelection("BrandGuidelines"), [handleCaptureStyleFromSelection]);
  const handleDesignSystemCapture = useCallback(() => handleCaptureStyleFromSelection("DesignSystem"), [handleCaptureStyleFromSelection]);

  // While the Batchamator panel is open, outline the canvas frame under the
  // mouse (light) and every checked frame (stronger) — a direct DOM effect
  // rather than new InfiniteHtmlCanvas props, since frame wrapper nodes are
  // keyed by frame.id and stable across re-renders.
  useEffect(() => {
    const active = showRightPanel && rightPanelTab === "batch";
    const wrappers = document.querySelectorAll<HTMLElement>("[data-frame-id]");
    wrappers.forEach(el => {
      const id = el.getAttribute("data-frame-id");
      if (!active || !id) {
        el.style.outline = "";
        el.style.outlineOffset = "";
        return;
      }
      if (id === batchHoveredFrameId) {
        el.style.outline = "2px solid rgba(200,184,152,0.55)";
        el.style.outlineOffset = "-2px";
      } else if (batchCheckedFrameIds.has(id)) {
        el.style.outline = "2px solid rgba(200,184,152,0.95)";
        el.style.outlineOffset = "-2px";
      } else {
        el.style.outline = "";
        el.style.outlineOffset = "";
      }
    });
  }, [showRightPanel, rightPanelTab, batchHoveredFrameId, batchCheckedFrameIds, frames]);

  // ── Element operations (align/group/reorder/copy-as) ──
  // Align funciona cross-frame: cada capa se mide dentro de su frame, se
  // eleva a espacio de canvas, y una bounding box compartida decide todos
  // los deltas. La escritura queda frame-local (el stylesheet de cada capa),
  // así que todo aterriza como UN paso deshacible — sin round-trip MCP ni
  // el reloadFromServer() que borraba el historial al volver.
  const handleAlign = useCallback((alignment: string) => {
    // La selección cross-frame gana; si no, el multi-select de este frame;
    // si no, el elemento único seleccionado.
    let targets: Array<{ frameId: string; layerId: string }> =
      crossFrameTargets.length > 1 ? crossFrameTargets : [];
    if (targets.length === 0 && selectedFrameId && multiSelectLayerIds.length > 0) {
      targets = multiSelectLayerIds.map(layerId => ({ frameId: selectedFrameId, layerId }));
    }
    if (targets.length === 0 && selectedFrameId && selectedElement
      && selectedElement.frameId === selectedFrameId && selectedElement.layerId) {
      targets = [{ frameId: selectedFrameId, layerId: selectedElement.layerId }];
    }
    if (targets.length < 1) return;

    // Medición por frame, luego lift de rects frame-locales a canvas.
    const byFrame = new Map<string, string[]>();
    for (const t of targets) {
      const ids = byFrame.get(t.frameId) || [];
      ids.push(t.layerId);
      byFrame.set(t.frameId, ids);
    }
    type CanvasRect = { frameId: string; layerId: string; left: number; top: number; width: number; height: number };
    const canvasRects: CanvasRect[] = [];
    let skipped = 0;
    for (const [frameId, layerIds] of byFrame) {
      const frame = frames.find(f => f.id === frameId);
      const wrapper = document.querySelector(`[data-frame-id="${frameId}"]`);
      const host = wrapper && [...wrapper.querySelectorAll("div")].find(el => el.shadowRoot?.getElementById("__df_content"));
      const content = host?.shadowRoot?.getElementById("__df_content");
      if (!frame || !content) continue;
      const rects = measureLayerRects(frameId, layerIds);
      if (!rects) continue;
      for (const r of rects) {
        // Escribir left/top solo reposiciona una capa posicionada absolute
        // en la raíz del frame; una capa anidada en otro contenedor se
        // posiciona relativo a su padre y se desplazaría por ese offset.
        const element: Element | null = content.querySelector(`[data-layer-id="${r.layerId}"]`);
        if (!element || element.parentElement !== content) { skipped += 1; continue; }
        canvasRects.push({
          frameId, layerId: r.layerId,
          left: frame.x + r.left, top: frame.y + r.top,
          width: r.width, height: r.height,
        });
      }
    }
    if (canvasRects.length < 1) {
      setMcpMsg("✗ Nada que alinear");
      setTimeout(() => setMcpMsg(""), 2000);
      return;
    }
    const minX = Math.min(...canvasRects.map(r => r.left));
    const maxX = Math.max(...canvasRects.map(r => r.left + r.width));
    const minY = Math.min(...canvasRects.map(r => r.top));
    const maxY = Math.max(...canvasRects.map(r => r.top + r.height));
    const deltaFor = (r: CanvasRect): [number, number] => {
      switch (alignment) {
        case "left": return [minX - r.left, 0];
        case "right": return [maxX - (r.left + r.width), 0];
        case "center": return [(minX + maxX) / 2 - (r.left + r.width / 2), 0];
        case "top": return [0, minY - r.top];
        case "bottom": return [0, maxY - (r.top + r.height)];
        case "middle": return [0, (minY + maxY) / 2 - (r.top + r.height / 2)];
        default: return [0, 0];
      }
    };
    // Reescribe left/top por frame; un string CSS editado por frame para que
    // varias capas del mismo frame se compongan en vez de pisarse.
    const cssByFrame = new Map<string, string>();
    for (const r of canvasRects) {
      const [dx, dy] = deltaFor(r);
      if (dx === 0 && dy === 0) continue;
      const frame = frames.find(f => f.id === r.frameId)!;
      const selector = `[data-layer-id="${r.layerId}"]`;
      let css = cssByFrame.get(r.frameId) ?? frame.css;
      if (dx !== 0) {
        const current = parseFloat(getCssPropertyValue(css, selector, "left")) || Math.round(r.left - frame.x);
        css = updateCssProperty(css, selector, "left", `${current + dx}px !important`);
      }
      if (dy !== 0) {
        const current = parseFloat(getCssPropertyValue(css, selector, "top")) || Math.round(r.top - frame.y);
        css = updateCssProperty(css, selector, "top", `${current + dy}px !important`);
      }
      cssByFrame.set(r.frameId, css);
    }
    if (cssByFrame.size > 0) {
      const updated = frames.map(f => {
        const css = cssByFrame.get(f.id);
        return css !== undefined ? { ...f, css } : f;
      });
      store.replaceAllWithUndo(updated, "align");
      autoSave(updated);
    }
    setMcpMsg(skipped > 0 ? `✓ Alineado (${skipped} capa(s) anidadas omitidas)` : "✓ Alineado");
    setTimeout(() => setMcpMsg(""), 2000);
  }, [crossFrameTargets, selectedFrameId, selectedElement, multiSelectLayerIds, frames, measureLayerRects, store, autoSave]);

  const handleGroup = useCallback(async () => {
    // ── Orphan grouping ──
    if (selectedOrphanIds.size >= 2) {
      const selected = canvasObjects.filter(o => selectedOrphanIds.has(o.id));
      if (selected.length < 2) return;
      const groupId = createOrphanId();
      // Compute bounds
      const minX = Math.min(...selected.map(o => o.x));
      const minY = Math.min(...selected.map(o => o.y));
      const maxX = Math.max(...selected.map(o => o.x + o.width));
      const maxY = Math.max(...selected.map(o => o.y + o.height));
      // Combine HTML: wrap children in a group div with display:contents.
      // Adjust each child's left/top to be relative to the group origin so
      // they preserve their visual canvas position inside the group.
      let combinedHtml = `<div data-layer-id="${groupId}" data-layer-name="Group" data-layer-kind="group" style="display:contents;">`;
      let combinedCss = "";
      for (const o of selected) {
        const relLeft = o.x - minX;
        const relTop = o.y - minY;
        // Adjust inline style left/top (for SVG-based orphans)
        let adjustedHtml = o.html
          .replace(/(style="[^"]*?left:\s*)\d+px/, `$1${relLeft}px`)
          .replace(/(style="[^"]*?top:\s*)\d+px/, `$1${relTop}px`);
        // Adjust CSS left/top/width/height for this child's data-layer-id rule
        const layerIdMatch = o.html.match(/data-layer-id="([^"]+)"/);
        if (layerIdMatch) {
          const lid = layerIdMatch[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          let adjustedCss = o.css;
          adjustedCss = adjustedCss.replace(
            new RegExp(`(\\[data-layer-id="${lid}"\\][^{]*\\{[^}]*?left:\\s*)\\d+px`, "s"),
            `$1${relLeft}px`,
          );
          adjustedCss = adjustedCss.replace(
            new RegExp(`(\\[data-layer-id="${lid}"\\][^{]*\\{[^}]*?top:\\s*)\\d+px`, "s"),
            `$1${relTop}px`,
          );
          combinedCss += "\n" + adjustedCss;
        } else {
          combinedCss += "\n" + o.css;
        }
        combinedHtml += adjustedHtml;
      }
      combinedHtml += "</div>";
      const groupOrphan: HtmlCanvasObject = {
        id: groupId, name: "Group",
        kind: "group", frameId: null,
        html: combinedHtml, css: combinedCss,
        x: minX, y: minY,
        width: maxX - minX, height: maxY - minY,
        zIndex: Math.max(...selected.map(o => o.zIndex)),
      };
      commitCanvasObjects([...canvasObjectsRef.current.filter(o => !selectedOrphanIds.has(o.id)), groupOrphan]);
      setSelectedOrphanIds(new Set([groupId]));
      return;
    }
    // ── Frame element grouping (local, consistent with layers panel) ──
    if (!selectedFrameId) return;
    if (multiSelectLayerIds.length < 2) {
      addToast("Selecciona dos o más capas para agruparlas.", "info");
      return;
    }
    const frame = frames.find(f => f.id === selectedFrameId);
    if (!frame) return;
    const result = groupLayersInHtml(
      frame.html,
      [...multiSelectLayerIds],
      `grp_${Date.now().toString(36)}`,
    );
    if (!result) {
      // Grouping only joins siblings. It used to fail here in silence, so a
      // click on Group simply did nothing and never said why — and the common
      // case is exactly this one: something inside a card selected together
      // with something at the root.
      addToast(
        "Solo se pueden agrupar capas que compartan el mismo padre. Estas están en niveles distintos del árbol.",
        "error",
      );
      return;
    }
    const updated = frames.map(f => f.id === selectedFrameId ? { ...f, html: result } : f);
    store.replaceAllWithUndo(updated, "group");
    autoSave(updated);
  }, [selectedFrameId, multiSelectLayerIds, selectedOrphanIds, canvasObjects, frames, autoSave, commitCanvasObjects, addToast]);

  const handleUngroup = useCallback(async () => {
    // ── Orphan ungrouping ──
    if (selectedOrphanIds.size > 0) {
      const newOrphans: HtmlCanvasObject[] = [];
      const toRemove = new Set<string>();
      for (const oid of selectedOrphanIds) {
        const obj = canvasObjects.find(o => o.id === oid);
        if (!obj) continue;
        // Parse the orphan's HTML to find group children with data-layer-id
        const parser = new DOMParser();
        const doc = parser.parseFromString(obj.html, "text/html");
        const groupWrapper = doc.body.firstElementChild;
        if (groupWrapper && groupWrapper.getAttribute("data-layer-kind") === "group") {
          // Extract each child as a separate orphan, preserving visual position
          let idx = 0;
          for (const child of Array.from(groupWrapper.children)) {
            const childHtml = child.outerHTML;
            const childLayerId = child.getAttribute("data-layer-id") || createOrphanId();
            // Parse inline style and/or CSS for child's relative position + dimensions
            let childLeft = 0, childTop = 0, childW = obj.width, childH = obj.height;
            const inlineStyle = (child as HTMLElement).style?.cssText || "";
            const inlineLeft = inlineStyle.match(/left:\s*(\d+(?:\.\d+)?)px/);
            const inlineTop = inlineStyle.match(/top:\s*(\d+(?:\.\d+)?)px/);
            const inlineW = inlineStyle.match(/width:\s*(\d+(?:\.\d+)?)px/);
            const inlineH = inlineStyle.match(/height:\s*(\d+(?:\.\d+)?)px/);
            if (inlineLeft) childLeft = parseFloat(inlineLeft[1]);
            if (inlineTop) childTop = parseFloat(inlineTop[1]);
            if (inlineW) childW = parseFloat(inlineW[1]);
            if (inlineH) childH = parseFloat(inlineH[1]);
            // Fallback: parse CSS rule for this child's layer-id
            if (!inlineLeft || !inlineTop) {
              const escapedId = childLayerId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
              const cssRuleRe = new RegExp(`\\[data-layer-id="${escapedId}"\\]\\s*\\{([^}]*)\\}`, "s");
              const cssMatch = obj.css.match(cssRuleRe);
              if (cssMatch) {
                const ruleBody = cssMatch[1];
                const cssLeft = ruleBody.match(/left:\s*(\d+(?:\.\d+)?)px/);
                const cssTop = ruleBody.match(/top:\s*(\d+(?:\.\d+)?)px/);
                const cssW = ruleBody.match(/width:\s*(\d+(?:\.\d+)?)px/);
                const cssH = ruleBody.match(/height:\s*(\d+(?:\.\d+)?)px/);
                if (!inlineLeft && cssLeft) childLeft = parseFloat(cssLeft[1]);
                if (!inlineTop && cssTop) childTop = parseFloat(cssTop[1]);
                if (!inlineW && cssW) childW = parseFloat(cssW[1]);
                if (!inlineH && cssH) childH = parseFloat(cssH[1]);
              }
            }
            // Filter CSS to only this child's rule + restore left/top to 0
            // (the orphan's x/y now carries the canvas position)
            let childCss = "";
            const escapedId2 = childLayerId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const cssRuleRe2 = new RegExp(`\\[data-layer-id="${escapedId2}"\\]\\s*\\{[^}]*\\}`, "s");
            const ruleMatch = obj.css.match(cssRuleRe2);
            if (ruleMatch) {
              // Extract the matched rule and reset left/top to 0 for the new standalone orphan
              childCss = ruleMatch[0]
                .replace(/left:\s*\d+(?:\.\d+)?px/, "left: 0")
                .replace(/top:\s*\d+(?:\.\d+)?px/, "top: 0");
            }
            newOrphans.push({
              id: childLayerId, name: child.getAttribute("data-layer-name") || `Layer ${idx + 1}`,
              kind: child.getAttribute("data-layer-kind") || "shape", frameId: null,
              html: childHtml, css: childCss,
              x: Math.round(obj.x + childLeft), y: Math.round(obj.y + childTop),
              width: Math.round(childW), height: Math.round(childH),
              zIndex: obj.zIndex + idx,
            });
            idx++;
          }
          toRemove.add(oid);
        }
      }
      if (newOrphans.length > 0) {
        commitCanvasObjects([...canvasObjectsRef.current.filter(o => !toRemove.has(o.id)), ...newOrphans]);
        setSelectedOrphanIds(new Set(newOrphans.map(o => o.id)));
        return;
      }
    }
    // ── Frame element ungrouping (safe: bakes positions + text styles first) ──
    if (!selectedFrameId || !selectedElement) return;
    // Never dissolve a leaf: ungrouping only makes sense with layer children.
    if (!selectedElement.childLayerCount) {
      addToast("Ese elemento no es un grupo (no tiene capas hijas).", "info");
      return;
    }
    const frame = frames.find(f => f.id === selectedFrameId);
    if (!frame) return;
    const bake = measureContainerForBake(selectedFrameId, selectedElement.layerId);
    if (!bake) {
      addToast("No se pudo medir el grupo para desagruparlo de forma segura. Intenta de nuevo en un momento.", "error");
      return;
    }
    const newHtml = ungroupPreservingLayout(frame.html, bake);
    if (!newHtml) return;
    const updated = frames.map(f => f.id === selectedFrameId ? { ...f, html: newHtml } : f);
    store.replaceAllWithUndo(updated, "ungroup");
    autoSave(updated);
    setSelectedElement(null);
  }, [selectedFrameId, selectedElement, selectedOrphanIds, canvasObjects, frames, autoSave, commitCanvasObjects]);

  /**
   * Dissolves every group nested under the selection, not only the outermost.
   *
   * Every group is measured against the live canvas BEFORE anything changes,
   * the same way a single ungroup does — dissolving first and measuring after
   * would read a layout that no longer matches, and the contents would drift.
   * Outermost first, which is the order the markup yields them in.
   */
  const handleUngroupAll = useCallback(() => {
    if (!selectedFrameId || !selectedElement) return;
    const frame = frames.find(f => f.id === selectedFrameId);
    if (!frame) return;

    const groupIds = nestedGroupIds(frame.html, selectedElement.layerId);
    if (groupIds.length === 0) {
      addToast("No hay grupos que deshacer en esta selección.", "info");
      return;
    }

    let html = frame.html;
    let dissolved = 0;
    let unmeasured = 0;
    for (const groupId of groupIds) {
      const bake = measureContainerForBake(selectedFrameId, groupId);
      // Leave a group that cannot be measured alone rather than guess at its
      // layout and move its contents.
      if (!bake) { unmeasured++; continue; }
      const next = ungroupPreservingLayout(html, bake);
      if (next) { html = next; dissolved++; }
    }

    if (!dissolved) {
      addToast("No se pudo medir ningún grupo para desagruparlo con seguridad.", "error");
      return;
    }
    const updated = frames.map(f => f.id === selectedFrameId ? { ...f, html } : f);
    store.replaceAllWithUndo(updated, "ungroup");
    autoSave(updated);
    setSelectedElement(null);
    addToast(unmeasured
      ? `${dissolved} grupo(s) deshecho(s); ${unmeasured} sin medir quedaron intactos.`
      : `${dissolved} grupo(s) deshecho(s).`, unmeasured ? "info" : "success");
  }, [selectedFrameId, selectedElement, frames, autoSave, addToast]);

  /** Moves the selected layer one step through its siblings, or to either end. */
  const handleStackChange = useCallback((move: LayerStackDirection | LayerStackEdge) => {
    if (!selectedFrameId || !selectedElement) return;
    const frame = frames.find(f => f.id === selectedFrameId);
    if (!frame) return;

    const change = move === "front" || move === "back"
      ? moveLayerToStackEdge(frame.html, selectedElement.layerId, move)
      : reorderLayerInStack(frame.html, selectedElement.layerId, move);
    if (!change) {
      addToast("La capa ya está en ese extremo de su grupo.", "info");
      return;
    }
    const updated = frames.map(f => f.id === selectedFrameId
      ? { ...f, html: change.html, css: applyLayerStack(f.css, change.siblingLayerIds) }
      : f);
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
  }, [selectedFrameId, selectedElement, frames, autoSave, addToast]);

  /**
   * Mirrors the selection. Written as a transform function rather than a whole
   * `transform` value so a rotation or translate already on the element
   * survives, and applying it twice returns to the original.
   */
  const handleFlip = useCallback((axis: "horizontal" | "vertical") => {
    if (!selectedFrameId || !selectedElement) return;
    const fn = axis === "horizontal" ? "scaleX" : "scaleY";
    let newCss = activeCss;
    for (const target of styleTargets(selectedElement.selector, selectedElement.layerId, multiSelectLayerIds)) {
      const current = getCssPropertyValue(newCss, target, "transform");
      const flipped = current.includes(`${fn}(-1)`)
        ? removeTransformFunction(current, fn)
        : setTransformFunction(current, fn, "-1");
      newCss = updateCssProperty(newCss, target, "transform", flipped || "none");
    }
    handleCssChange(newCss);
  }, [selectedFrameId, selectedElement, multiSelectLayerIds, activeCss, handleCssChange]);

  /**
   * Pastes the copied element into every frame at once.
   *
   * Each frame gets its own fresh layer ids, or the second paste would collide
   * with the first and the CSS would address both at the same time.
   */
  const handlePasteInAllFrames = useCallback(() => {
    const clipboard = readDesignClipboard();
    if (!clipboard || clipboard.kind !== "element") {
      addToast("Copia un elemento primero (pegar en todos los frames no aplica a frames enteros).", "error");
      return;
    }
    if (frames.length === 0) return;
    const sourceLayer = extractLayerFromHtml(clipboard.html, clipboard.layerId);
    if (!sourceLayer) {
      addToast("No se pudo leer el elemento copiado.", "error");
      return;
    }

    let pastedInto = 0;
    const updated = frames.map(frame => {
      const pasted = pasteLayerFromHtml(frame.html, clipboard.html, clipboard.layerId, createLayerId, 0);
      if (!pasted) return frame;
      const pastedCss = cloneLayerTreeCss(clipboard.css, sourceLayer.layerHtml, sourceLayer.layerIds, pasted.idMap, 0, pasted.referenceIdMap);
      pastedInto++;
      return { ...frame, html: pasted.html, css: mergeCssRules(frame.css, pastedCss) };
    });

    if (!pastedInto) {
      addToast("No se pudo pegar en ningún frame.", "error");
      return;
    }
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
    addToast(`Pegado en ${pastedInto} frame(s).`, "success");
  }, [frames, autoSave, addToast]);

  /** Lock and visibility for the selection, mirroring the layers panel's toggles. */
  const selectedIsLocked = selectedFrameId && selectedElement
    ? lockedLayersByFrame.get(selectedFrameId)?.has(selectedElement.layerId) || false
    : false;
  const selectedIsHidden = selectedFrameId && selectedElement
    ? hiddenLayersByFrame.get(selectedFrameId)?.has(selectedElement.layerId) || false
    : false;

  const handleToggleSelectedLock = useCallback(() => {
    if (!selectedFrameId || !selectedElement) return;
    handleLockToggle(selectedFrameId, selectedElement.layerId, !selectedIsLocked);
  }, [selectedFrameId, selectedElement, selectedIsLocked, handleLockToggle]);

  const handleToggleSelectedVisibility = useCallback(() => {
    if (!selectedFrameId || !selectedElement) return;
    handleHideToggle(selectedFrameId, selectedElement.layerId, !selectedIsHidden);
  }, [selectedFrameId, selectedElement, selectedIsHidden, handleHideToggle]);

  /**
   * A page cannot open the browser's DevTools — there is no API for it, by
   * design. What it can do is hand the real node to the console, where
   * "Reveal in Elements panel" takes you the rest of the way.
   */
  const handleInspectElement = useCallback(() => {
    if (!selectedFrameId || !selectedElement) return;
    const wrapper = document.querySelector(`[data-frame-id="${selectedFrameId}"]`);
    const host = wrapper && [...wrapper.querySelectorAll("div")].find(el => el.shadowRoot?.getElementById("__df_content"));
    const node = host?.shadowRoot?.getElementById("__df_content")?.querySelector(selectedElement.selector);
    if (!node) {
      addToast("No se encontró el nodo en el lienzo.", "error");
      return;
    }
    // eslint-disable-next-line no-console
    console.log("[Futuraria] Elemento seleccionado:", selectedElement.selector, node);
    addToast("Elemento enviado a la consola. Abre DevTools (F12) y haz clic derecho → «Revelar en el panel Elements».", "info");
  }, [selectedFrameId, selectedElement, addToast]);

  // ── Figma-style container semantics toggle: Grupo (posiciones fijas) ⇄ Contenedor (auto layout) ──
  const handleGroupModeChange = useCallback((layerId: string, frameId: string, mode: "group" | "container") => {
    const frame = frames.find(f => f.id === frameId);
    if (!frame) return;
    const bake = measureContainerForBake(frameId, layerId);
    if (!bake) { addToast("No se pudo medir el grupo en el lienzo.", "error"); return; }
    const newHtml = mode === "group"
      ? convertContainerToGroup(frame.html, bake)
      : convertGroupToContainer(frame.html, bake);
    if (!newHtml || newHtml === frame.html) return;
    const updated = frames.map(f => f.id === frameId ? { ...f, html: newHtml } : f);
    store.replaceAllWithUndo(updated, mode === "group" ? "to-group" : "to-container");
    autoSave(updated);
    addToast(mode === "group"
      ? "Convertido a Grupo: cada hijo ahora es dueño de su posición y tipografía."
      : "Convertido a Contenedor: los hijos fluyen en auto layout.", "success");
  }, [frames, autoSave, addToast]);

  const handleReorder = useCallback(async (direction: "up" | "down" | "top" | "bottom") => {
    if (!selectedFrameId || !selectedElement) return;
    setMcpLoading("reorder");
    try {
      await callMcp("reorder_element", {
        templateId, frameId: selectedFrameId, elementId: selectedElement.layerId, direction,
      });
      await reloadFromServer();
      setMcpMsg("✓ Reordered");
    } catch { setMcpMsg("✗ Reorder failed"); }
    setMcpLoading(null);
    setTimeout(() => setMcpMsg(""), 2000);
  }, [selectedFrameId, selectedElement, templateId, callMcp, reloadFromServer]);

  const handleCopyAs = useCallback(async (format: "html" | "css" | "json") => {
    if (!selectedFrameId || !selectedElement) return;
    try {
      const data = await callMcp("copy_as", {
        templateId, frameId: selectedFrameId, elementId: selectedElement.layerId, format,
      });
      const text = typeof data === "string" ? data : (data?.content || JSON.stringify(data, null, 2));
      await navigator.clipboard.writeText(text);
      setMcpMsg(`✓ Copied as ${format.toUpperCase()}`);
    } catch { setMcpMsg("✗ Copy failed"); }
    setTimeout(() => setMcpMsg(""), 2000);
  }, [selectedFrameId, selectedElement, templateId, callMcp]);

  // ── Smart Layout toggle ──
  const handleSmartLayout = useCallback(async (mode: "smart" | "fixed") => {
    setLayoutMode(mode);
    if (mode === "smart" && selectedFrameId) {
      setMcpLoading("smart");
      try {
        await callMcp("smart_layout", {
          templateId, frameId: selectedFrameId,
          layout: "grid",
        });
        await reloadFromServer();
        setMcpMsg("✓ Smart layout applied");
      } catch { setMcpMsg("✗ Smart layout failed"); }
      setMcpLoading(null);
    } else if (mode === "fixed" && selectedFrameId) {
      // Remove smart layout CSS by reloading original template
      await reloadFromServer();
      setMcpMsg("✓ Fixed layout restored");
    }
    setTimeout(() => setMcpMsg(""), 2000);
  }, [selectedFrameId, templateId, callMcp, reloadFromServer]);

  // ── Design system actions ──
  const handleLintDesign = useCallback(async () => {
    setMcpLoading("lint");
    try {
      const data = await callMcp("lint_design", { templateId });
      const issues = data?.issues || [];
      setMcpMsg(`✓ Lint: ${issues.length} issues found`);
    } catch { setMcpMsg("✗ Lint failed"); }
    setMcpLoading(null);
    setTimeout(() => setMcpMsg(""), 3000);
  }, [templateId, callMcp]);

  const handleExportTokens = useCallback(async () => {
    setMcpLoading("tokens");
    try {
      const data = await callMcp("export_design_tokens", { templateId });
      const json = JSON.stringify(data?.tokens || data, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      downloadBlob(blob, `${templateName.replace(/[^a-zA-Z0-9_]/g, "_")}_tokens.json`);
      setMcpMsg("✓ Tokens exported");
    } catch { setMcpMsg("✗ Token export failed"); }
    setMcpLoading(null);
    setTimeout(() => setMcpMsg(""), 3000);
  }, [templateId, templateName, callMcp]);

  // The frames export actually acts on: the multi-select if there is one,
  // else whichever single frame is active — same resolution rule already
  // used for copy/paste (captureSelection above).
  const exportTargetFrames = useMemo(() => {
    const ids = selectedFrameIds.size > 0
      ? selectedFrameIds
      : new Set(selectedFrameId ? [selectedFrameId] : []);
    return frames.filter(f => ids.has(f.id));
  }, [frames, selectedFrameId, selectedFrameIds]);
  const [showPrintDialog, setShowPrintDialog] = useState(false);

  // JSON and Tokens ignore the selection entirely — both always operate on
  // the whole template (see ExportPanel's WHOLE_TEMPLATE_FORMATS). Declared
  // after handleExportJSON/handleExportTokens so this can list them as
  // dependencies.
  const handleUnifiedExport = useCallback(async (format: ExportFormat) => {
    if (format === "json") { await handleExportJSON(); return; }
    if (format === "tokens") { await handleExportTokens(); return; }
    if (format === "designSystem") { await handleExtractDesignSystem(); return; }
    if (format === "css") { handleExportCss(); return; }
    if (exportTargetFrames.length === 0) return;
    // PDF Impresión no exporta directo: abre el dialog de opciones
    // (página/orientación/perfil + progreso del job).
    if (format === "printPdf") { setShowPrintDialog(true); return; }
    if (format === "png" || format === "jpg") await handleExportFramesPNG(exportTargetFrames, format);
    else if (format === "svg") await handleExportFramesSVG(exportTargetFrames);
    else if (format === "pdf") await handleExportFramesPDF(exportTargetFrames);
  }, [exportTargetFrames, handleExportFramesPNG, handleExportFramesSVG, handleExportFramesPDF,
      handleExportJSON, handleExportTokens, handleExtractDesignSystem, handleExportCss]);

  // ── Import template ──
  const importTemplateFile = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await callMcp("import_template", { data, workspaceId: templateWorkspaceId });
      setMcpMsg("✓ Template imported");
    } catch { setMcpMsg("✗ Import failed"); }
    setTimeout(() => setMcpMsg(""), 3000);
  }, [callMcp, templateWorkspaceId]);

  const handleImportRoute = useCallback((route: ImportRoute, file?: File) => {
    setShowImportRouter(false);
    if (route === "template") {
      if (file) importTemplateFile(file);
      return;
    }
    setRoutedImportFiles(file ? [file] : []);
    if (route === "svg") setShowSvgImport(true);
    else if (route === "design") setShowDesignImport(true);
    else if (route === "html") setShowPasteHtml(true);
  }, [importTemplateFile]);

  // Editor-wide file drop batches design files through the same importer as
  // the button. That keeps N dropped files as N frames instead of repeatedly
  // replacing the modal's single pending-file state.
  const [isAppDragOver, setIsAppDragOver] = useState(false);
  const appDragCounterRef = useRef(0);

  const handleAppDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
  }, []);

  const handleAppDragEnter = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    appDragCounterRef.current += 1;
    setIsAppDragOver(true);
  }, []);

  const handleAppDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    appDragCounterRef.current = Math.max(0, appDragCounterRef.current - 1);
    if (appDragCounterRef.current === 0) setIsAppDragOver(false);
  }, []);

  const handleAppDrop = useCallback((e: React.DragEvent) => {
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    e.preventDefault();
    appDragCounterRef.current = 0;
    setIsAppDragOver(false);
    // A file-related modal is already open with its own drop zone — let it
    // handle this drop instead of double-processing the file.
    if (showImportRouter || showSvgImport || showDesignImport || showPasteHtml) return;
    const dropped = Array.from(files);
    const designFiles = dropped.filter(file => /\.(?:svg|psd|ai|pdf|fig|png|jpe?g|webp)$/i.test(file.name));
    const otherFiles = dropped.filter(file => !designFiles.includes(file));
    if (designFiles.length) {
      setRoutedImportFiles(designFiles);
      setShowDesignImport(true);
    }
    // A mixed drop may also contain one HTML/template file. Route it only when
    // no design modal was opened; two simultaneous dialogs would be ambiguous.
    if (!designFiles.length && otherFiles.length === 1) {
      const route = detectImportRoute(otherFiles[0]);
      if (route) handleImportRoute(route, otherFiles[0]);
      else addToast(`No se reconoce el tipo de archivo "${otherFiles[0].name}".`, "error");
    } else if (otherFiles.length) {
      addToast(`${otherFiles.length} archivo(s) no se importaron porque el lote mezcla formatos de diseño y documento.`, "info");
    }
  }, [showImportRouter, showSvgImport, showDesignImport, showPasteHtml, handleImportRoute, addToast]);

  // ── Dockable panels ──
  const rightDock = useDockablePanel(window.innerWidth - 290, 56, "right");
  const layersDock = useDockablePanel(380, 56, "left");
  const toolbarDock = useDockablePanel(20, 80, "left");

  const layersIsDocked = showLayersPanel && layersDock.state.isDocked;
  const layersDockOffset = 0;
  const leftPanelsWidth = (layersIsDocked && layersDock.state.dockSide === "left" ? 260 : 0);
  const toolbarLeft = toolbarDock.state.isDocked ? leftPanelsWidth : undefined;
  // Docked panels float via position:fixed (see useDockablePanel) so by
  // default they render OVER the canvas instead of reserving space for it —
  // the ruler, being sized to its own container, then draws its ticks
  // straight through them. Insetting the canvas by each currently-docked
  // panel's width makes the canvas (and therefore the ruler, which measures
  // this same shrunken container) stop before the panel instead of running
  // under it. Undocked/dragging panels are free-floating and don't reserve
  // space; z-index ordering (see CanvasGuides) keeps them visually on top
  // of the ruler in that case instead.
  const canvasLeftInset = isMobile
    ? 0
    : leftPanelsWidth + (toolbarDock.state.isDocked ? 56 : 0);
  const canvasRightInset = isMobile
    ? 0
    : (showRightPanel && rightDock.state.isDocked && rightDock.state.dockSide === "right") ? rightPanelWidth : 0;

  // On phones the toolbar is hidden and panels are full-screen overlays
  // (see the responsive rules), so nothing may reserve space beside the
  // canvas — it stretches edge to edge like an accordion.

  // ── Background Render Worker ──
  // Polls for pending render jobs created by MCP export_batch.
  // When jobs are found, renders each frame via rasterizeFrame (frameCapture.ts)
  // and uploads the resulting PNG to the server for AI agent retrieval.
  const renderWorkerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const renderingRef = useRef(false);
  // Only poll when a render job has been explicitly requested.
  // Without this gate, the worker fires every 10s on every template load,
  // hitting a non-existent endpoint (/api/render/queue/pending) and generating 400s.
  const renderPollEnabledRef = useRef(false);

  useEffect(() => {
    // Skip entirely if no render job has been queued — prevents the constant
    // stream of 400 errors from polling a non-existent endpoint.
    if (!renderPollEnabledRef.current) return;

    const API_BASE = window.location.origin;
    const POLL_INTERVAL = 10000; // 10 seconds

    const processJob = async (job: any) => {
      const frame = framesRef.current.find(f => f.id === job.frameId);
      if (!frame) {
        console.warn("[RenderWorker] Frame not found for job", job);
        return;
      }

      try {
        const canvas = await rasterizeFrame(
          { html: frame.html, css: frame.css, width: frame.width, height: frame.height, background: frame.background || "transparent" },
          job.scale || 2,
        );
        const dataUrl = canvas.toDataURL("image/png");

        // Upload to server
        await fetch(`${API_BASE}/api/render/job/${job.jobId}/complete`, {
          method: "POST",
          headers: getApiHeaders(),
          body: JSON.stringify({ pngDataUrl: dataUrl }),
        });
      } catch (err) {
        console.warn("[RenderWorker] Render failed", err);
      }
    };

    const poll = async () => {
      if (renderingRef.current) return; // Don't stack polls
      try {
        const res = await fetch(`${API_BASE}/api/render/queue/pending?templateId=${encodeURIComponent(templateId)}`, { headers: getApiHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        const pending: any[] = data.pending || [];
        if (pending.length === 0) return;

        renderingRef.current = true;
        for (const job of pending) {
          await processJob(job);
        }
        renderingRef.current = false;
      } catch {
        /* silent - will retry next poll */
        renderingRef.current = false;
      }
    };

    // Initial poll + interval
    poll();
    renderWorkerRef.current = setInterval(poll, POLL_INTERVAL);

    return () => {
      if (renderWorkerRef.current) clearInterval(renderWorkerRef.current);
    };
  }, [templateId]);

  // ── Loading / Error ──
  // Shell-first boot: while `loading` the chrome below renders immediately —
  // topbar, back button and file name are live from the first paint — and only
  // the canvas area is swapped for a skeleton (see CanvasBootSkeleton).
  // Every persistence path is guarded by loadingRef until data arrives.
  if (error) {
    return (
      <div style={{ display: "flex", height: "100vh", width: "100vw", background: "#080808", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ color: "#f87171", fontSize: 16, marginBottom: 12 }}>{error}</div>
          <button type="button" onClick={() => { telemetryBackClick("error-view"); onBack(); }} className="glass-btn">
            <IconArrowLeft size={14} /> Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const RIGHT_PANEL_TITLES: Record<string, string> = {
    contextual: "Properties",
    history: "History",
    meta: "Information",
    styleLibrary: "Biblioteca",
    batch: "Batchamator",
    ai: "AI Settings",
    genImage: "Generar Imagen",
    layerSplit: "Separar en Capas",
  };

  return (
    <div
      className={`editor-v2-root${loading ? " is-booting" : ""}`}
      onDragEnter={handleAppDragEnter}
      onDragOver={handleAppDragOver}
      onDragLeave={handleAppDragLeave}
      onDrop={handleAppDrop}
    >
      {isAppDragOver && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999, pointerEvents: "none",
          border: "3px dashed #c8b898", background: "rgba(200,184,152,0.06)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: "#111", color: "#e0e0e0", padding: "10px 18px", borderRadius: 8,
            fontSize: 14, border: "1px solid rgba(200,184,152,0.4)",
          }}>
            Suelta el archivo para agregarlo
          </div>
        </div>
      )}
      {/* Musa Hands overlay: mirrored camera + skeleton + status. Renders only
          while the mode is on; it unmounts (and the camera light dies) on ✕. */}
      {gestureOn && <GestureHUD onOff={() => setGestureOn(false)} />}
      {/* The air cursor: the pointing finger rendered as a dot (non-interactive). */}
      {gestureOn && <GestureCursor />}
      {/* ═══ Top Bar ═══ */}
      <div className="editor-v2-topbar">
        <button type="button" onClick={() => { telemetryBackClick("topbar"); onBack(); }} className="editor-v2-topbar-btn editor-v2-back-btn" title="Back to Dashboard">
          <IconArrowLeft size={14} />
        </button>
        {/* Hamburger — visible on mobile/tablet */}
        <button type="button" className="editor-v2-hamburger" onClick={() => setMobileMenuOpen(true)} aria-label="Open menu">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        {editingTemplateName !== null ? (
          <input
            ref={templateNameInputRef}
            value={editingTemplateName}
            onChange={e => setEditingTemplateName(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") commitTemplateRename();
              if (e.key === "Escape") { setEditingTemplateName(null); }
            }}
            onBlur={commitTemplateRename}
            className="editor-v2-project-name"
            autoFocus
            style={{
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(200,184,152,0.4)",
              borderRadius: 4,
              color: "#c8b898",
              fontSize: 13,
              fontFamily: "inherit",
              padding: "2px 8px",
              outline: "none",
              width: 200,
            }}
          />
        ) : (
          <span
            className="editor-v2-project-name"
            onDoubleClick={() => setEditingTemplateName(templateName)}
            title="Double-click to rename workspace"
            style={{ cursor: "text" }}
          >
            {templateName}
          </span>
        )}
        {/* A-09: espacio reservado — el botón "Historial" ya no salta cuando
            entra/sale el indicador de guardado. */}
        <span className="editor-v2-saving" style={{ visibility: saving ? "visible" : "hidden" }}>Saving...</span>
        {activeAgents.length > 0 && (
          <span className="editor-v2-agents">
            <span className="editor-v2-agents-dot" />
            {activeAgents.length}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {vertexEditModeLayer && (
          <span
            title={`Editing vertices of layer ${vertexEditModeLayer}`}
            style={{
              display: "inline-flex", alignItems: "center",
              padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600,
              background: "rgba(139,92,246,0.18)", border: "1px solid rgba(139,92,246,0.45)",
              color: "#d8c9ff", whiteSpace: "nowrap",
            }}
          >
            Editing vertices — Enter/Esc to finish
          </span>
        )}

        {/* ═══ Zona: Documento (zoom + guardado de versión) ═══ */}
        <div className="editor-v2-topbar-group" data-tour="topbar-documento" style={{ display: "flex", alignItems: "center", gap: "var(--tb-inner-gap, 6px)" }}>
          {/* Zoom: minus, the live level (click to type an exact %), plus.
              No magnifiers — "- 100% +" already reads as zoom, and the glyphs
              were three icons doing one icon's work. The tool itself lives in
              the left toolbar; what stays here is the readout. */}
          <button
            type="button"
            className="editor-v2-topbar-icon-btn"
            onClick={handleZoomOut}
            title="Alejar"
            style={{ fontSize: 15, lineHeight: 1, fontFamily: "SF Mono, monospace" }}
          >
            −
          </button>
          {editingZoomTopbar ? (
            <input
              type="number"
              step={5}
              min={5}
              max={500}
              autoFocus
              defaultValue={Math.round(zoom * 100)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const v = parseInt((e.target as HTMLInputElement).value) || 100;
                  handleZoomSet(Math.min(500, Math.max(5, v)) / 100);
                  setEditingZoomTopbar(false);
                }
                if (e.key === "Escape") setEditingZoomTopbar(false);
              }}
              onBlur={(e) => {
                const raw = parseInt((e.target as HTMLInputElement).value);
                if (!isNaN(raw)) handleZoomSet(Math.min(500, Math.max(5, raw)) / 100);
                setEditingZoomTopbar(false);
              }}
              style={{
                width: 46, height: 24, borderRadius: 6, textAlign: "center",
                background: "rgba(200,184,152,0.12)", border: "1px solid #c8b898",
                color: "#c8b898", fontSize: 11, fontFamily: "SF Mono, monospace",
                outline: "none", padding: 0,
              }}
            />
          ) : (
            <button
              type="button"
              className="editor-v2-topbar-icon-btn"
              onClick={() => setEditingZoomTopbar(true)}
              title="Click to edit zoom %"
              style={{ fontSize: 11, fontFamily: "SF Mono, monospace" }}
            >
              {Math.round(zoom * 100)}%
            </button>
          )}
          <button
            type="button"
            className="editor-v2-topbar-icon-btn"
            onClick={handleZoomIn}
            title="Acercar"
            style={{ fontSize: 15, lineHeight: 1, fontFamily: "SF Mono, monospace" }}
          >
            +
          </button>

          <button
            type="button"
            className="editor-v2-topbar-icon-btn"
            onClick={handleSaveVersion}
            disabled={savingVersion}
            title="Guardar versión (Ctrl/⌘+S) — queda permanente en el historial"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
            <span className="editor-v2-topbar-label editor-v2-topbar-label-priority">{savingVersion ? "…" : "Guardar"}</span>
          </button>

          {/* Musa Hands: hands-free control for the demo (REQ Gesture Mode).
              Small and quiet on purpose — borrows the Save button's shape.
              Click toggles the whole mode; Esc from inside also turns it off.
              OCULTO por decisión del humano (2026-09-28): la funcionalidad queda
              intacta (estado, telemetría, get_recent_gestures), solo no se pinta
              el botón — nadie puede entrar al modo desde la UI. Para
              reactivarlo, cambia el `false` de abajo por `true`. */}
          {false && (
            <button
              type="button"
              className="editor-v2-topbar-icon-btn"
              onClick={() => setGestureOn((v) => !v)}
              title="Musa Hands — controla el editor con gestos (Esc apaga)"
              style={gestureOn ? { color: "#c4b5fd" } : undefined}
            >
              <span style={{ fontSize: 13, lineHeight: 1 }}>👋</span>
              <span style={{ fontSize: 11, marginLeft: 3 }}>{gestureOn ? "Manos ON" : "Manos"}</span>
            </button>
          )}

          {/* History/Info moved to the Paneles cluster (Fase 1): the four
              right-panel toggles live together now — one group to scan
              instead of one button remembered per zone. */}
        </div>

        <div className="editor-v2-topbar-sep" />

        {/* ═══ Zona: Paneles — los 4 botones que abren el panel derecho,
            juntos: encontrar el que buscas es escanear UN grupo, no recordar
            en qué zona quedó cada panel. Bajo 1536px colapsan a un menú "⋯"
            para que ningún panel quede inaccesible en laptops chicas. ═══ */}
        <div className="editor-v2-topbar-group editor-v2-topbar-group-compactable" data-tour="topbar-paneles" style={{ display: "flex", alignItems: "center", gap: "var(--tb-inner-gap, 6px)" }}>
          {isNarrowTopbar ? (
            <div style={{ position: "relative" }}>
              <button
                type="button"
                className={`editor-v2-topbar-icon-btn ${showMorePanels ? "active" : ""}`}
                onClick={() => setShowMorePanels(v => !v)}
                title="Paneles — Historial, Info, Biblioteca, Propiedades"
                aria-describedby={showPreviewReminder ? "preview-reminder" : undefined}
              >
                <span style={{ fontSize: 13, lineHeight: 1 }}>⋯</span>
                <span className="editor-v2-topbar-label">Paneles</span>
              </button>
              {showPreviewReminder && (
                <PreviewReminderPopover onOpen={openPreviewCaptureGuide} onDismiss={dismissPreviewReminder} />
              )}
              <TopbarMenu open={showMorePanels} onClose={() => setShowMorePanels(false)} width={250}>
                {([
                  { tab: "history", label: "Historial", desc: "Versiones guardadas del archivo" },
                  { tab: "meta", label: "Info", desc: "Marca, campaña, tags y conexiones del grafo" },
                  { tab: "styleLibrary", label: "Biblioteca", desc: "Estilos (Brand Guidelines), Plantillas y Recursos" },
                  { tab: "designSystem", label: "Design System", desc: "Archivo DS de la marca: extrae y agrega" },
                  { tab: "contextual", label: "Props", desc: "Propiedades de lo seleccionado" },
                ] as const).map(({ tab, label, desc }) => (
                  <TopbarMenuItem
                    key={tab}
                    title={label}
                    desc={desc}
                    active={showRightPanel && rightPanelTab === tab}
                    onClick={() => { toggleRightPanel(tab); setShowMorePanels(false); }}
                  />
                ))}
              </TopbarMenu>
            </div>
          ) : (
            <>
              <button
                type="button"
                className={`editor-v2-topbar-icon-btn ${showRightPanel && rightPanelTab === "history" ? "active" : ""}`}
                onClick={() => toggleRightPanel("history")}
                title="Historial — versiones guardadas del archivo"
              >
                <IconHistory size={14} />
                <span className="editor-v2-topbar-label">Historial</span>
              </button>
              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  className={`editor-v2-topbar-icon-btn ${showRightPanel && rightPanelTab === "meta" ? "active" : ""}`}
                  onClick={() => toggleRightPanel("meta")}
                  title="Info — marca, campaña, tags y conexiones del grafo"
                  aria-describedby={showPreviewReminder ? "preview-reminder" : undefined}
                >
                  <IconInfo size={14} />
                  <span className="editor-v2-topbar-label">Info</span>
                </button>
                {showPreviewReminder && (
                  <PreviewReminderPopover onOpen={openPreviewCaptureGuide} onDismiss={dismissPreviewReminder} />
                )}
              </div>
              {/* Biblioteca: Estilos (Brand Guidelines), Plantillas (Key
                  Visuals) y Recursos (Assets) viven en sus pestañas internas. */}
              <button
                type="button"
                className={`editor-v2-topbar-icon-btn ${showRightPanel && rightPanelTab === "styleLibrary" ? "active" : ""}`}
                onClick={() => toggleRightPanel("styleLibrary")}
                title="Biblioteca — Estilos, Plantillas y Recursos"
              >
                <IconPalette size={14} />
                <span className="editor-v2-topbar-label">Biblioteca</span>
              </button>
              {/* Design System de la marca: el archivo único donde vive todo
                  lo extraído/agregado para la marca ("1 marca = 1 DS", v35). */}
              <button
                type="button"
                className={`editor-v2-topbar-icon-btn ${showRightPanel && rightPanelTab === "designSystem" ? "active" : ""}`}
                onClick={() => toggleRightPanel("designSystem")}
                title="Design System — el archivo de la marca donde se guarda lo extraído"
              >
                <IconLayers size={14} />
                <span className="editor-v2-topbar-label">Design System</span>
              </button>
              <button
                type="button"
                className={`editor-v2-topbar-icon-btn ${showRightPanel && rightPanelTab === "contextual" ? "active" : ""}`}
                onClick={() => toggleRightPanel("contextual")}
                title="Propiedades de lo seleccionado"
              >
                <IconSliders size={14} />
                <span className="editor-v2-topbar-label">Props</span>
              </button>
            </>
          )}
        </div>

        <div className="editor-v2-topbar-sep" />

        {/* ═══ Zona: Vista — reglas, grilla y guías del lienzo en un solo
            menú con checkmarks reales (antes eran 4 botones permanentes que
            solo se usaban al armar el diseño). El toggle de capas sigue en
            la barra de herramientas izquierda, con las demás herramientas. ═══ */}
        <div className="editor-v2-topbar-group editor-v2-topbar-group-compactable" data-tour="topbar-vista" style={{ display: "flex", alignItems: "center", gap: "var(--tb-inner-gap, 6px)" }}>
          <div style={{ position: "relative" }}>
            <button
              type="button"
              className={`editor-v2-topbar-icon-btn ${showViewMenu ? "active" : ""}`}
              onClick={() => setShowViewMenu(v => !v)}
              title="Vista — reglas, grilla de píxeles y guías"
            >
              <IconColumns size={14} />
              <span className="editor-v2-topbar-label">Vista</span>
              <span style={{ marginLeft: 3, display: "flex" }}><IconChevronDown size={11} /></span>
            </button>
            <TopbarMenu open={showViewMenu} onClose={() => setShowViewMenu(false)} width={260}>
              <TopbarMenuItem
                icon={<IconRuler size={14} />}
                title="Reglas"
                desc="Medidas en los bordes del lienzo (Ctrl+R)"
                active={showRulers}
                trailing={showRulers ? <span style={{ fontSize: 13, color: "#c8b898" }}>✓</span> : null}
                onClick={() => { setShowRulers(v => !v); setShowViewMenu(false); }}
              />
              <TopbarMenuItem
                icon={<IconGrid size={14} />}
                title="Grilla de píxeles"
                desc="Alineación fina al píxel (Ctrl+')"
                active={showGrid}
                trailing={showGrid ? <span style={{ fontSize: 13, color: "#c8b898" }}>✓</span> : null}
                onClick={() => { setShowGrid(v => !v); setShowViewMenu(false); }}
              />
              <TopbarMenuItem
                icon={<span style={{ fontSize: 11, fontWeight: 700 }}>Aa</span>}
                title="Letras de atajos"
                desc="Muestra u oculta las letras de atajo en los botones de la barra de herramientas izquierda"
                active={showToolbarShortcuts}
                trailing={showToolbarShortcuts ? <span style={{ fontSize: 13, color: "#c8b898" }}>✓</span> : null}
                onClick={() => { setShowToolbarShortcuts(v => !v); setShowViewMenu(false); }}
              />
              <TopbarMenuItem
                icon={<IconColumns size={14} />}
                title="Guías de columnas"
                desc="Configurar columnas de layout"
                active={showColumnPanel}
                trailing={showColumnPanel ? <span style={{ fontSize: 13, color: "#c8b898" }}>✓</span> : null}
                onClick={() => { setShowColumnPanel(v => !v); setShowViewMenu(false); }}
              />
              <TopbarMenuItem
                icon={<IconEraser size={14} />}
                title="Limpiar guías"
                desc="Quita las guías manuales del lienzo"
                disabled={guides.length === 0}
                onClick={() => { setGuides([]); setShowViewMenu(false); }}
              />
            </TopbarMenu>
          </div>
        </div>

        <div className="editor-v2-topbar-sep" />

        {/* ═══ Zona: Automatizaciones (IA + generación en lote) ═══ */}
        <div className="editor-v2-topbar-group editor-v2-topbar-group-compactable" data-tour="topbar-automatizaciones" style={{ display: "flex", alignItems: "center", gap: "var(--tb-inner-gap, 6px)" }}>
          {/* IA ▾ — the seven AI actions that lived here as emoji-only
              buttons (🪄 ✦ 🍌 🧅 🎬 Lint ⚙️). One trigger, named entries:
              nobody has to guess what 🧅 does, and the bar loses the width
              of ~8 permanent buttons. */}
          <div style={{ position: "relative" }}>
            <button
              type="button"
              className={`editor-v2-topbar-icon-btn ${showAiMenu ? "active" : ""}`}
              onClick={() => setShowAiMenu(v => !v)}
              title="IA — imagen a diseño, vectorizar, imagen/video, capas, lint, ajustes"
            >
              <IconWand size={14} />
              <span className="editor-v2-topbar-label">IA</span>
              <span style={{ marginLeft: 3, display: "flex" }}><IconChevronDown size={11} /></span>
            </button>
            <TopbarMenu open={showAiMenu} onClose={() => setShowAiMenu(false)} width={310}>
              <TopbarMenuItem
                icon={mcpLoading === "imageToDesign" ? "⏳" : "🪄"}
                title="Imagen → Diseño"
                desc="Convierte la imagen seleccionada en un diseño"
                disabled={mcpLoading === "imageToDesign"}
                onClick={() => { setShowAiMenu(false); if (!geminiConfigured) { openAiConfigPanel(); return; } handleConvertSelectedImageToDesign(); }}
              />
              <TopbarMenuItem
                icon={traceBusy ? "⏳" : <IconPen size={14} />}
                title="Vectorizar imagen (local)"
                desc="Buscatrazos en tu navegador, sin IA (REQ-043)"
                disabled={traceBusy}
                onClick={() => { setShowAiMenu(false); handleTraceSelectedImage("Black and White Logo"); }}
              />
              <TopbarMenuItem
                icon={vectorizeLoading ? "⏳" : "✦"}
                title="Vectorizar"
                desc="Imagen seleccionada → SVG editable (Quiver AI)"
                disabled={vectorizeLoading}
                onClick={() => { setShowAiMenu(false); if (!quiverConfigured) { openAiConfigPanel(); return; } handleVectorizeSelectedImage(); }}
              />
              <TopbarMenuItem
                icon="🍌"
                title="Nano Banana"
                desc="Genera o edita imágenes con IA (Gemini)"
                active={showRightPanel && rightPanelTab === "genImage"}
                onClick={() => { setShowAiMenu(false); toggleRightPanel("genImage"); }}
              />
              <TopbarMenuItem
                icon={splitStatus !== "idle" ? "⏳" : "🧅"}
                title="Separar en capas"
                desc="Divide la imagen en capas editables (Seedream 5.0 Pro)"
                active={showRightPanel && rightPanelTab === "layerSplit"}
                onClick={() => { setShowAiMenu(false); toggleRightPanel("layerSplit"); }}
              />
              <TopbarMenuItem
                icon={videoStatus !== "idle" ? "⏳" : "🎬"}
                title="Generar video"
                desc="Video desde la imagen seleccionada (RunwayML Gen-4)"
                active={showRightPanel && rightPanelTab === "videoGen"}
                onClick={() => { setShowAiMenu(false); toggleRightPanel("videoGen"); }}
              />
              <TopbarMenuItem
                icon={mcpLoading === "lint" ? "⏳" : <IconWand size={14} />}
                title="Lint del diseño"
                desc="Revisa el diseño en busca de problemas"
                disabled={mcpLoading === "lint"}
                onClick={() => { setShowAiMenu(false); handleLintDesign(); }}
              />
              <TopbarMenuItem
                icon="⚙️"
                title="Ajustes de IA"
                desc="Modelo y API keys sin salir del editor"
                active={showRightPanel && rightPanelTab === "ai"}
                onClick={() => { setShowAiMenu(false); toggleRightPanel("ai"); }}
              />
            </TopbarMenu>
          </div>

          {/* Batchamator — un botón, tres flujos: Content Machine, Brand
              Guidelines, Design System. Ver handleContentMachine /
              handleBrandGuidelinesCapture / handleDesignSystemCapture.
              La "B" de 9px no se leía — ahora es "Batch". */}
          <div style={{ position: "relative" }}>
            <button
              type="button"
              className={`editor-v2-topbar-icon-btn ${(showRightPanel && rightPanelTab === "batch") || showBatchMenu ? "active" : ""}`}
              onClick={() => setShowBatchMenu(v => !v)}
              title="Batchamator — Content Machine, Brand Guidelines, Design System"
            >
              <IconGrid size={14} />
              <span className="editor-v2-topbar-label">Batch</span>
              <span style={{ marginLeft: 3, display: "flex" }}><IconChevronDown size={11} /></span>
            </button>
            <TopbarMenu open={showBatchMenu} onClose={() => setShowBatchMenu(false)} width={250}>
              <TopbarMenuItem
                icon="📄"
                title="Content Machine"
                desc="Guarda como Plantilla + Assets, exporta CSV para generar variantes"
                onClick={() => { setShowBatchMenu(false); handleContentMachine(); }}
              />
              <TopbarMenuItem
                icon="🎨"
                title="Brand Guidelines"
                desc="Toma el frame como logotipo y arma un Style de marca"
                onClick={() => { setShowBatchMenu(false); handleBrandGuidelinesCapture(); }}
              />
              <TopbarMenuItem
                icon="🧩"
                title="Design System"
                desc="Toma el frame como inspiración y arma un Style reusable"
                onClick={() => { setShowBatchMenu(false); handleDesignSystemCapture(); }}
              />
            </TopbarMenu>
          </div>
        </div>

        <button
          type="button"
          className="editor-v2-topbar-icon-btn editor-v2-topbar-priority"
          onClick={() => setPresentationOpen(true)}
          disabled={frames.length === 0}
          title="Presentar — muestra los frames a pantalla completa"
        >
          <IconMonitor size={14} />
          <span className="editor-v2-topbar-label">Presentar</span>
        </button>
        {/* Selector de superficie: Diseño, Video y Foto comparten documento,
            historial y guardado; el menú evita competir por espacio en la barra. */}
        <div style={{ position: "relative" }}>
          <button
            type="button"
          className={`editor-v2-topbar-icon-btn editor-v2-topbar-priority ${showEditorMenu || videoModeOpen || photoModeOpen ? "active" : ""}`}
            onClick={() => setShowEditorMenu(open => !open)}
            title={`Editor actual: ${videoModeOpen ? "Video" : photoModeOpen ? "Foto" : "Diseño"}`}
            aria-haspopup="menu"
            aria-expanded={showEditorMenu}
          >
            {videoModeOpen ? <IconPlay size={14} /> : photoModeOpen ? <IconCamera size={14} /> : <IconPalette size={14} />}
            <span className="editor-v2-topbar-label">Editor</span>
            <span style={{ marginLeft: 3, display: "flex" }}><IconChevronDown size={11} /></span>
          </button>
          <TopbarMenu open={showEditorMenu} onClose={() => setShowEditorMenu(false)} width={290}>
            <TopbarMenuItem
              icon={<IconPalette size={16} />}
              title="Editor de diseño"
              desc="Frames, capas, tipografía y composición"
              active={!videoModeOpen && !photoModeOpen}
              onClick={() => handleSelectEditor("design")}
            />
            <TopbarMenuItem
              icon={<IconPlay size={16} />}
              title="Editor de video"
              desc="Timeline, tomas, audio, transiciones y exportación"
              active={videoModeOpen}
              onClick={() => handleSelectEditor("video")}
            />
            <TopbarMenuItem
              icon={<IconCamera size={16} />}
              title="Editor de fotos"
              desc="Revelado no destructivo: fotos del diseño o frames rasterizados"
              active={photoModeOpen}
              onClick={() => handleSelectEditor("photo")}
            />
          </TopbarMenu>
        </div>

        <div className="editor-v2-topbar-sep" />

        {/* ═══ Zona: Import / Export (mover contenido dentro y fuera) ═══ */}
        <div className="editor-v2-topbar-group editor-v2-topbar-group-compactable" data-tour="topbar-import-export" style={{ display: "flex", alignItems: "center", gap: "var(--tb-inner-gap, 6px)" }}>
          {/* Import: single entry point that routes to the right tool (SVG
              editor, design-file import, or HTML/CSS import) based on
              what's dropped or picked — see ImportRouterModal. */}
          <button
            type="button"
            className="editor-v2-topbar-icon-btn"
            onClick={() => setShowImportRouter(true)}
            title="Import (SVG, PSD, AI, FIG, HTML/CSS, Template JSON)"
            style={{ color: "var(--editor-accent, #6c5ce7)" }}
          >
            <IconUpload size={14} />
            <span className="editor-v2-topbar-label">Import</span>
          </button>

          {/* Export: format dropdown + scope toggle + export button */}
          <ExportPanel
            frames={frames}
            selectedFrames={exportTargetFrames}
            onExport={handleUnifiedExport}
          />

          {/* Comments: pins on the canvas + the panel (add to canvas,
              resolve, delete). The badge counts open pins — the ones still
              competing for attention. */}
          <button
            type="button"
            className={`editor-v2-topbar-icon-btn ${showRightPanel && rightPanelTab === "comments" ? "active" : ""}`}
            onClick={() => toggleRightPanel("comments")}
            title="Comentarios"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
            <span className="editor-v2-topbar-label">Comentarios</span>
            {comments.filter(c => c.status === "open").length > 0 && (
              <span style={{ marginLeft: 4, background: "rgba(245,158,11,0.85)", color: "#111", borderRadius: 8, padding: "0 6px", fontSize: 10, fontWeight: 700 }}>
                {comments.filter(c => c.status === "open").length}
              </span>
            )}
          </button>

          {/* Share ▾ — copy link + visibilidad en un solo popover: la
              visibilidad es parte de compartir (antes eran dos botones
              permanentes). A guest (client, teammate, phone) opens the
              /c/:templateId link without an account, taps the design to pin
              comments, and can file them to the Kanban for the AI. */}
          <div style={{ position: "relative" }}>
            <button
              type="button"
              className={`editor-v2-topbar-icon-btn ${showShareMenu ? "active" : ""}`}
              onClick={() => setShowShareMenu(v => !v)}
              title="Compartir — copiar enlace y visibilidad (público/privado)"
            >
              <IconShare size={14} />
              <span className="editor-v2-topbar-label">Compartir</span>
              <span style={{ marginLeft: 3, display: "flex" }}><IconChevronDown size={11} /></span>
            </button>
            <TopbarMenu open={showShareMenu} onClose={() => setShowShareMenu(false)} width={300}>
              <TopbarMenuItem
                icon={<IconShare size={14} />}
                title="Copiar enlace"
                desc="Feedback desde el móvil — el invitado entra con su cuenta"
                onClick={() => {
                  setShowShareMenu(false);
                  const url = `${window.location.origin}/c/${templateId}`;
                  // v50: private by default — copying the link while the
                  // design is private hands out a URL that only shows the
                  // auth gate, so the toast has to say so.
                  const done = () => addToast(
                    isPublic
                      ? "Enlace copiado. El invitado verá el diseño tras iniciar sesión."
                      : "Enlace copiado, pero el diseño está PRIVADO: pásalo a Público para que puedan verlo.",
                    isPublic ? "success" : "error",
                  );
                  if (navigator.clipboard?.writeText) {
                    navigator.clipboard.writeText(url).then(done).catch(() => {});
                    return;
                  }
                  const ta = document.createElement("textarea");
                  ta.value = url;
                  ta.style.position = "fixed";
                  ta.style.opacity = "0";
                  document.body.appendChild(ta);
                  ta.select();
                  try {
                    document.execCommand("copy");
                    done();
                  } catch { /* clipboard blocked — user can copy from the address bar */ }
                  document.body.removeChild(ta);
                }}
              />
              <TopbarMenuItem
                icon={<span style={{ color: isPublic ? "#34d399" : "#f87171" }}>{isPublic ? "◉" : "○"}</span>}
                title={publicBusy ? "Cambiando visibilidad…" : isPublic ? "Público — pasar a privado" : "Privado — pasar a público"}
                desc={isPublic ? "Los invitados ven el diseño y comentan" : "El enlace no abrirá el diseño hasta que lo hagas público"}
                disabled={publicBusy}
                onClick={() => { setShowShareMenu(false); void handleTogglePublic(); }}
              />
            </TopbarMenu>
          </div>
        </div>

        {/* ═══ User Account (fixed in editor — sign out without leaving) ═══ */}
        {user ? (
          <div style={{ position: "relative", marginLeft: "auto", flexShrink: 0 }}>
            <button
              type="button"
              className="editor-v2-topbar-icon-btn"
              onClick={() => setUserMenuOpen(v => !v)}
              aria-label="Account menu"
              title={user.email || "Account"}
              style={{ gap: 6 }}
            >
              <span style={{
                width: 20, height: 20, borderRadius: "50%",
                background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 10, fontWeight: 700, color: "#fff", flexShrink: 0,
              }}>
                {editorAccountName ? editorAccountName[0].toUpperCase() : "?"}
              </span>
              <span className="editor-v2-account-name" style={{ maxWidth: "clamp(64px, 6vw, 96px)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 }}>
                {editorAccountName || "Account"}
              </span>
              <IconChevronDown size={11} />
            </button>
            {userMenuOpen && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 49 }} onClick={() => setUserMenuOpen(false)} />
                <div
                  style={{
                    position: "absolute", top: "calc(100% + 6px)", right: 0,
                    minWidth: 200, borderRadius: 10, padding: 6, zIndex: 50,
                    background: "rgba(8, 8, 8, 0.92)",
                    backdropFilter: "blur(16px) saturate(180%)",
                    WebkitBackdropFilter: "blur(16px) saturate(180%)",
                    border: "1px solid rgba(200, 184, 152, 0.12)",
                    boxShadow: "0 8px 32px rgba(0, 0, 0, 0.5)",
                  }}
                >
                  <div style={{ padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)", marginBottom: 4 }}>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 0.5 }}>Sesión activa</div>
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.8)", marginTop: 2, wordBreak: "break-all" }}>{user.email}</div>
                  </div>

                  {/* Somewhere to go, not just a way out. The editor's only
                      route back used to be the back arrow, which lands on
                      Archivos — so reaching the graph or the CRM from here
                      meant two navigations. Each of these leaves through the
                      same door as the back arrow, so the auto-snapshot on
                      unmount still runs, then asks the dashboard for a tab. */}
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 0.5, padding: "4px 12px" }}>
                    Ir a
                  </div>
                  {EDITOR_NAV_TABS.map(tab => (
                    <button
                      key={tab.label}
                      type="button"
                      onClick={() => {
                        setUserMenuOpen(false);
                        try {
                          sessionStorage.setItem("dashboardInitialTab", tab.id);
                          if (tab.pane) sessionStorage.setItem("dashboardInitialPane", tab.pane);
                        } catch { /* private mode */ }
                        onBack();
                      }}
                      style={{
                        width: "100%", textAlign: "left", padding: "7px 12px", borderRadius: 6,
                        cursor: "pointer", fontSize: 12, background: "transparent", border: "none",
                        color: "rgba(255,255,255,0.82)", fontFamily: "inherit",
                      }}
                      onMouseOver={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
                      onMouseOut={e => { e.currentTarget.style.background = "transparent"; }}
                    >
                      {tab.label}
                    </button>
                  ))}

                  <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", margin: "4px 0" }} />
                  <button
                    type="button"
                    onClick={() => { void handleSignOut(); }}
                    style={{
                      width: "100%", textAlign: "left", padding: "8px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12,
                      background: "transparent", border: "none", color: "#f87171", fontFamily: "inherit",
                      display: "flex", alignItems: "center", gap: 8,
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
                    Cerrar sesión
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>

      {presentationOpen && (
        <DesignPresentation
          frames={frames}
          initialFrameId={selectedFrameId}
          onClose={closePresentation}
        />
      )}
      {/* ═══ Column Config Panel ═══ */}
      {showColumnPanel && (
        <div style={{
          position: "absolute", top: 56, right: 16, zIndex: 6000,
          background: "rgba(28,28,30,0.97)", backdropFilter: "blur(16px)",
          border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10,
          padding: "16px 18px", width: 240, boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
          fontFamily: "Inter, system-ui, sans-serif",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.9)" }}>Column Guides</span>
            <button
              type="button"
              onClick={() => setShowColumnPanel(false)}
              style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", padding: 2 }}
            >
              <IconX size={14} />
            </button>
          </div>

          {/* Enable/disable — las columnas se muestran en TODOS los frames a
              la vez; ya no hace falta clickear frames de a uno. */}
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={columnsEnabled}
              onChange={(e) => {
                setColumnsEnabled(e.target.checked);
                if (e.target.checked && !columnConfig) setColumnConfig({ count: 6, gutter: 24, margin: 48 });
                if (!e.target.checked) setColumnOverrides({});
              }}
              style={{ accentColor: "#3B82F6" }}
            />
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>Mostrar columnas en todos los frames</span>
          </label>

          {columnsEnabled && activeColumnConfig && (
            <>
              {/* Apply-all: apagado = las ediciones tocan solo el frame
                  seleccionado (override por frame, session-only por decisión). */}
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={columnsApplyAll}
                  onChange={(e) => {
                    setColumnsApplyAll(e.target.checked);
                    if (e.target.checked) setColumnOverrides({});
                  }}
                  style={{ accentColor: "#3B82F6" }}
                />
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>Aplicar cambios a todos los frames</span>
              </label>
              {/* Count */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 4 }}>Columns</label>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="range" min={1} max={24} step={1}
                    value={activeColumnConfig.count}
                    onChange={(e) => applyColumnEdit({ count: parseInt(e.target.value) })}
                    style={{ flex: 1, accentColor: "#3B82F6" }}
                  />
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.9)", width: 28, textAlign: "right", fontFamily: "monospace" }}>{activeColumnConfig.count}</span>
                </div>
              </div>

              {/* Gutter */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 4 }}>Gutter (px)</label>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="range" min={0} max={100} step={1}
                    value={activeColumnConfig.gutter}
                    onChange={(e) => applyColumnEdit({ gutter: parseInt(e.target.value) })}
                    style={{ flex: 1, accentColor: "#3B82F6" }}
                  />
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.9)", width: 28, textAlign: "right", fontFamily: "monospace" }}>{activeColumnConfig.gutter}</span>
                </div>
              </div>

              {/* Margin */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 4 }}>Margin (px)</label>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="range" min={0} max={200} step={1}
                    value={activeColumnConfig.margin}
                    onChange={(e) => applyColumnEdit({ margin: parseInt(e.target.value) })}
                    style={{ flex: 1, accentColor: "#3B82F6" }}
                  />
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.9)", width: 28, textAlign: "right", fontFamily: "monospace" }}>{activeColumnConfig.margin}</span>
                </div>
              </div>

              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8 }}>
                {columnsApplyAll
                  ? "Mostrando y editando en todos los frames"
                  : selectedFrameId
                    ? "Editando solo el frame seleccionado"
                    : "Selecciona un frame para editarlo"}
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══ Hamburger Slide-out Menu (mobile/tablet) ═══ */}
      {mobileMenuOpen && (
        <>
          <div className="landing-menu-overlay" onClick={() => setMobileMenuOpen(false)} />
          <div className="landing-menu-panel">
            <div className="landing-menu-header">
              <span style={{ fontSize: 16, fontWeight: 600, color: "rgba(255,255,255,0.8)" }}>Menu</span>
              <button type="button" className="landing-menu-close" onClick={() => setMobileMenuOpen(false)} aria-label="Close menu">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="landing-menu-nav">
              {/* Title */}
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "rgba(255,255,255,0.3)", padding: "0 12px", marginBottom: 4 }}>Actions</div>
              
              {/* Properties tabs */}
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "rgba(255,255,255,0.3)", padding: "8px 12px 4px" }}>Panels</div>
              <button type="button" className="landing-menu-link"
                onClick={() => {
                  if (showRightPanel && rightPanelTab === "history") setShowRightPanel(false);
                  else { setRightPanelTab("history"); setShowRightPanel(true); }
                  setMobileMenuOpen(false);
                }}
                style={{ fontSize: 13, padding: "10px 14px" }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <IconHistory size={16} /> History
                </span>
              </button>
              <button type="button" className="landing-menu-link"
                onClick={() => {
                  if (showRightPanel && rightPanelTab === "contextual") setShowRightPanel(false);
                  else { setRightPanelTab("contextual"); setShowRightPanel(true); }
                  setMobileMenuOpen(false);
                }}
                style={{ fontSize: 13, padding: "10px 14px" }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <IconSliders size={16} /> Properties
                </span>
              </button>
              <button type="button" className="landing-menu-link"
                onClick={() => {
                  if (showRightPanel && rightPanelTab === "meta") setShowRightPanel(false);
                  else { setRightPanelTab("meta"); setShowRightPanel(true); }
                  setMobileMenuOpen(false);
                }}
                style={{ fontSize: 13, padding: "10px 14px" }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <IconInfo size={16} /> Information
                </span>
              </button>
              
              <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "8px 0" }} />
              
              <button type="button" className="landing-menu-link"
                onClick={() => {
                  if (showRightPanel && rightPanelTab === "styleLibrary") setShowRightPanel(false);
                  else { setRightPanelTab("styleLibrary"); setShowRightPanel(true); }
                  setMobileMenuOpen(false);
                }}
                style={{ fontSize: 13, padding: "10px 14px" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <IconPalette size={16} /> Biblioteca
                </span>
              </button>
              <button type="button" className="landing-menu-link" onClick={() => { setShowFontPicker(!showFontPicker); setMobileMenuOpen(false); }}
                style={{ fontSize: 13, padding: "10px 14px" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <IconType size={16} /> Font Picker
                </span>
              </button>
              <button type="button" className="landing-menu-link" onClick={() => { setShowImportRouter(true); setMobileMenuOpen(false); }}
                style={{ fontSize: 13, padding: "10px 14px" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <IconUpload size={16} /> Import
                </span>
              </button>

              <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "8px 0" }} />

              <button type="button" className="landing-menu-link" onClick={() => { duplicateFrame(); setMobileMenuOpen(false); }}
                style={{ fontSize: 13, padding: "10px 14px" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <IconCopy size={16} /> Duplicate Frame
                </span>
              </button>
              <button type="button" className="landing-menu-link" onClick={() => { deleteSelectedFrame(); setMobileMenuOpen(false); }}
                disabled={frames.length <= 1}
                style={{ fontSize: 13, padding: "10px 14px", opacity: frames.length <= 1 ? 0.3 : 1 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <IconTrash size={16} /> Delete Frame
                </span>
              </button>
              
              <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "8px 0" }} />
              
              <button type="button" className="landing-menu-link" onClick={() => { handleOpenDesignSystemPanel(); setMobileMenuOpen(false); }}
                style={{ fontSize: 13, padding: "10px 14px" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <IconLayers size={16} /> Design System de la marca
                </span>
              </button>
              <button type="button" className="landing-menu-link" onClick={() => { handleConvertSelectedImageToDesign(); setMobileMenuOpen(false); }}
                style={{ fontSize: 13, padding: "10px 14px", background: "rgba(200,184,152,0.1)" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 16 }}>🪄</span> Image to Design
                </span>
              </button>
              <button type="button" className="landing-menu-link" onClick={() => { setShowIconPicker(true); setMobileMenuOpen(false); }}
                style={{ fontSize: 13, padding: "10px 14px" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <IconShapes size={16} /> Icons
                </span>
              </button>
              
              <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "8px 0" }} />
              
              <button type="button" className="landing-menu-link" onClick={() => { handleLintDesign(); setMobileMenuOpen(false); }}
                style={{ fontSize: 13, padding: "10px 14px" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <IconWand size={16} /> Lint Design
                </span>
              </button>
              <button type="button" className="landing-menu-link" onClick={() => { handleContentMachine(); setMobileMenuOpen(false); }}
                style={{ fontSize: 13, padding: "10px 14px" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <IconGrid size={16} /> Batchamator: Content Machine
                </span>
              </button>
              <button type="button" className="landing-menu-link" onClick={() => { handleBrandGuidelinesCapture(); setMobileMenuOpen(false); }}
                style={{ fontSize: 13, padding: "10px 14px" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <IconGrid size={16} /> Batchamator: Brand Guidelines
                </span>
              </button>
              <button type="button" className="landing-menu-link" onClick={() => { handleDesignSystemCapture(); setMobileMenuOpen(false); }}
                style={{ fontSize: 13, padding: "10px 14px" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <IconGrid size={16} /> Batchamator: Design System
                </span>
              </button>
            </div>
          </div>
        </>
      )}

      {/* ═══ Font Picker Dropdown ═══ */}
      {showFontPicker && (
        <div className="editor-v2-font-picker-dropdown">
          <GoogleFontPicker value={selectedFont} onChange={handleFontSelect} />
        </div>
      )}

      {/* ═══ Main Area ═══ */}
      <div className="editor-v2-main" data-tour="editor-canvas">
        {/* ── Layers Panel (slide-in from left) ── */}
        {showLayersPanel && (
          <div className="editor-v2-layers-panel" data-tour="editor-layers" style={layersDock.panelStyle(260, layersDockOffset)}>
            <div className="dock-handle" {...layersDock.handleProps}>
              <span>Layers</span>
              <button type="button" onClick={() => layersDock.toggleDock("left")} className="dock-pin-btn" title={layersDock.state.isDocked ? "Undock" : "Dock left"}>
                {layersDock.state.isDocked ? "📌" : "📍"}
              </button>
            </div>
            <HtmlLayersPanel
              frames={frames}
              canvasObjects={canvasObjects}
              selectedFrameId={selectedFrameId}
              selectedFrameIds={selectedFrameIds}
              selectedOrphanIds={selectedOrphanIds}
              selectedElementId={selectedElement?.layerId || null}
              selectedElementIds={multiSelectLayerIds}
              onSelectFrame={handleSelectFrame}
              onFrameShiftClick={handleFrameShiftClick}
              onSelectElement={handleSelectLayerElement}
              onSelectOrphan={handleSelectOrphan}
              onOrphanShiftClick={handleOrphanShiftClick}
              onOrphanDelete={handleDeleteOrphan}
              onHtmlChange={handleFrameHtmlChange}
              onLayerStackChange={handleLayerStackChange}
              onLayerDrop={handleLayerDrop}
              onFrameReorder={handleFrameReorder}
              onLayerDelete={(frameId, layerId) => handleDeleteElement(layerId, frameId)}
              onLayerDuplicate={(frameId, layerId) => handleDuplicateElement(layerId, frameId)}
              onSeparateText={handleSeparateText}
              onMultiSelectChange={setMultiSelectLayerIds}
              onLockToggle={handleLockToggle}
              onHideToggle={handleHideToggle}
              lockedLayersByFrame={lockedLayersByFrame}
              hiddenLayersByFrame={hiddenLayersByFrame}
              onOrphanDropToFrame={handleOrphanDropToFrame}
            />
          </div>
        )}

        {/* ── Canvas (fills remaining space) ── */}
        <div
          id="canvas-container"
          className="editor-v2-canvas-area"
          onContextMenu={(e) => {
            e.preventDefault();
            if (loading) return; // boot — nothing to act on yet
            setContextMenu({
              x: e.clientX,
              y: e.clientY,
              hasClipboard: readDesignClipboard() !== null,
              maskTarget: detectMaskTarget(e.nativeEvent),
            });
          }}
        >
          {/* ── Insert Toolbar (toggleable) ── */}
          {!videoModeOpen && !photoModeOpen && showInsertBar && (
            <div className="editor-v2-insert-bar">
            <InsertToolbar
              templateId={templateId}
              onHtmlUpdated={(html, css) => {
                if (selectedFrameId) {
                  handleFrameCssChange(selectedFrameId, css, html);
                }
              }}
            />
            </div>
          )}
          {videoModeOpen ? (
            /* ═══ Modo Video v2 — modo EMBEBIDO en el canvas-area (estilo
                CapCut): sustituye el canvas pero conserva la top bar del
                editor. El overlay trae sus propias 4 zonas (media, player,
                inspector, timeline). ═══ */
            <VideoModeOverlay
              frames={frames}
              selectedFrameId={selectedFrameId}
              onAnimationFrameChange={handleFrameAnimationChange}
              onFrameReelChange={handleFrameReelChange}
              onFrameReelFilterChange={handleFrameReelFilterChange}
              onFrameReelFxChange={handleFrameReelFxChange}
              onFrameReelOverlayFxChange={handleFrameReelOverlayFxChange}
              onFrameReelParticlesChange={handleFrameReelParticlesChange}
              onFrameLayoutChange={handleFrameReelLayoutChange}
              onFrameLayerZChange={handleFrameLayerZChange}
              onAdaptWithAI={handleAdaptFrameWithAI}
              onBakeToDesign={handleBakeFrameToDesign}
              onFramesReorder={handleFramesReorder}
              onClose={() => setVideoModeOpen(false)}
              addToast={addToast}
              workspaceId={templateWorkspaceId || ""}
              videoTimelineDoc={videoTimelineDocState}
              onVideoTimelineChange={handleVideoTimelineChange}
              videoDocStore={videoDocStore}
              onVideoUndoFallback={handleUndo}
              onVideoRedoFallback={handleRedo}
              templateName={templateName}
              saveState={saving ? "saving" : "saved"}
            />
          ) : photoModeOpen ? (
            /* ═══ Modo Foto (REQ-PHOTO-PLATFORM-001) — Lightroom Develop
                embebido: sustituye el canvas y conserva la top bar. Todo el
                revelado corre client-side (WebGL2); la red solo entra en
                acciones explícitas (guardar receta / subir variante). ═══ */
            <PhotoModeOverlay
              frames={frames}
              canvasObjects={canvasObjects}
              workspaceId={templateWorkspaceId || ""}
              initialTarget={photoModeTarget}
              extraTargets={photoExtraTargets}
              onClose={() => setPhotoModeOpen(false)}
              addToast={addToast}
              onApplyToLayer={handlePhotoApplyToLayer}
              onApplyToAllInstances={handlePhotoApplyToAllInstances}
            />
          ) : loading ? (
            <CanvasBootSkeleton name={templateName} />
          ) : (
          <InfiniteHtmlCanvas
            leftInset={canvasLeftInset}
            rightInset={canvasRightInset}
            onIconDrop={handleIconDropOnCanvas}
            frames={frames}
            canvasObjects={canvasObjects}
            selectedFrameIds={selectedFrameIds}
            selectedOrphanIds={selectedOrphanIds}
            contentFrameId={contentFrameId}
            activeTool={activeTool}
            foregroundColor={foregroundColor}
            backgroundColor={backgroundColor}
            zoom={zoom}
            onSelectFrame={handleSelectFrame}
            onActivateFrame={handleActivateFrame}
            onFrameShiftClick={handleFrameShiftClick}
            onMarqueeSelect={handleMarqueeSelect}
            onMarqueeSelectOrphans={handleMarqueeSelectOrphans}
            onEnterContentMode={handleEnterContentMode}
            onZoomChange={setZoom}
            onFrameMove={handleFrameMove}
            onMultiFrameMove={handleMultiFrameMove}
            onDuplicateFrames={handleDuplicateFramesAtPositions}
            onRenameFrame={handleRenameFrame}
            onElementSelect={handleElementSelect}
            onLayerEscape={handleLayerEscape}
            onRequestLayerSelect={(frameId, layerId, additive) => handleSelectLayerElement(frameId, layerId, undefined, additive)}
            layerSelectionRequest={layerSelectionRequest}
            selectedElement={selectedElement}
            selectedLayerIds={multiSelectLayerIds}
            onLayerSelectionChange={handleLayerSelectionChange}
            onFrameCssChange={handleFrameCssChange}
            onFrameHtmlChange={handleFrameHtmlChange}
            onAddPrimitive={handleAddPrimitive}
            onDrawShape={handleDrawShape}
            onTextChange={handleTextChange}
            onAddPenPath={handleAddPenPath}
            onAddTextPath={handleAddTextPath}
            onAddTextBox={handleAddTextBox}
            onEditPathPoints={handleEditPathPoints}
            onVertexEditModeChange={(_frameId, layerId) => setVertexEditModeLayer(layerId)}
            onElementDelete={handleDeleteElement}
            onElementDuplicate={handleDuplicateElement}
            onBrushStroke={(frameId, imageLayerId, stroke) => handleBrushStroke(frameId, imageLayerId, stroke)}
            brushSize={brushSize}
            onWandSegment={(frameId, imageLayerId, src, points) => handleWandSegment(frameId, imageLayerId, src, points)}
            wandLoading={wandBusy}
            onFrameResize={handleFrameResize}
            onCreateFrame={handleCreateFrameAt}
            onCreateOrphanFromTool={handleCreateOrphanFromTool}
            onCreateOrphanText={handleCreateOrphanText}
            onSelectOrphan={handleSelectOrphan}
            onOrphanShiftClick={handleOrphanShiftClick}
            onOrphanMove={handleOrphanMove}
            onOrphanResize={handleOrphanResize}
            onOrphanRotate={handleOrphanRotate}
            onOrphanRadiusChange={handleOrphanRadiusChange}
            onOrphanDropToFrame={handleOrphanDropToFrame}
            onDeleteOrphan={handleDeleteOrphan}
            onOrphanHtmlChange={handleOrphanHtmlChange}
            autoEditOrphanId={autoEditOrphanId}
            onAutoEditOrphanHandled={() => setAutoEditOrphanId(null)}
            autoEditLayerId={autoEditLayerId}
            onAutoEditHandled={() => setAutoEditLayerId(null)}
            guides={guides}
            onGuidesChange={setGuides}
            showGrid={showGrid}
            gridSize={gridSize}
            showRulers={showRulers}
            selectedGuideId={selectedGuideId}
            onSelectGuide={setSelectedGuideId}
            columnOverlays={columnsEnabled && columnConfig
              ? frames.map(f => ({
                  config: columnOverrides[f.id] ?? columnConfig,
                  bounds: { x: f.x, y: f.y, width: f.width, height: f.height },
                }))
              : []}
            smartGuides={[]}
            onEyedropperPick={handleEyedropperPick}
            comments={comments}
            showComments={showComments}
            commentMode={commentMode}
            commentBounds={commentBounds}
            onCommentRequest={handleCommentRequest}
            onCommentPinClick={(commentId) => {
              setHighlightCommentId(commentId);
              window.setTimeout(() => setHighlightCommentId(null), 2500);
            }}
            onCommentPinMove={handleCommentPinMove}
            onCommentEdit={handleCommentEdit}
            onCommentResolve={handleResolveComment}
            onCommentDelete={handleDeleteComment}
            onCommentToKanban={handleCommentToKanban}
          />
          )}
          {/* REQ-022 — zero-frame empty state: deleting the last frame is a
              valid place to be, not a dead end. This card keeps the file
              usable by offering the first frame's dimensions directly. */}
          {frames.length === 0 && !loading && !error && !videoModeOpen && !photoModeOpen && (
            <div
              aria-label="Archivo sin frames"
              style={{
                position: "absolute", inset: 0, zIndex: 6,
                display: "flex", alignItems: "center", justifyContent: "center",
                pointerEvents: "none",
              }}
            >
              <div
                style={{
                  pointerEvents: "auto",
                  display: "flex", flexDirection: "column", gap: 10,
                  width: 300, padding: "22px 24px", borderRadius: 16,
                  background: "rgba(13,16,26,0.92)",
                  border: "1px solid rgba(99,102,241,0.35)",
                  boxShadow: "0 24px 64px rgba(0,0,0,0.45)",
                  fontFamily: "inherit",
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>Este archivo está vacío</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", marginBottom: 2 }}>
                  Agrega el primer frame con el formato que necesitas.
                </div>
                <select
                  value={emptyFormatId}
                  onChange={e => {
                    const id = e.target.value;
                    const preset = SOCIAL_FORMATS.find(f => f.id === id);
                    setEmptyFormatId(id);
                    if (preset) {
                      setEmptyW(String(preset.width));
                      setEmptyH(String(preset.height));
                    }
                  }}
                  aria-label="Formato del frame a crear"
                  style={{
                    width: "100%", boxSizing: "border-box",
                    padding: "8px 10px", borderRadius: 8, fontSize: 12, cursor: "pointer",
                    background: "rgba(9,11,18,0.95)", border: "1px solid rgba(99,102,241,0.5)",
                    color: "rgba(255,255,255,0.9)", fontFamily: "inherit", outline: "none",
                  }}
                >
                  {SOCIAL_FORMATS.map(f => (
                    <option key={f.id} value={f.id}>{f.label} — {f.width}×{f.height}</option>
                  ))}
                  <option value={CUSTOM_FORMAT_ID}>Personalizado…</option>
                </select>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="number" min={1} max={10000}
                    value={emptyW}
                    onChange={e => {
                      setEmptyW(e.target.value);
                      if (emptyFormatId !== CUSTOM_FORMAT_ID) setEmptyFormatId(CUSTOM_FORMAT_ID);
                    }}
                    aria-label="Ancho del frame en píxeles"
                    style={{
                      width: 86, padding: "7px 9px", borderRadius: 8, fontSize: 12,
                      background: "rgba(9,11,18,0.95)", border: "1px solid rgba(99,102,241,0.5)",
                      color: "rgba(255,255,255,0.9)", fontFamily: "inherit", outline: "none",
                    }}
                  />
                  <span aria-hidden="true" style={{ color: "rgba(255,255,255,0.4)", fontSize: 12 }}>×</span>
                  <input
                    type="number" min={1} max={10000}
                    value={emptyH}
                    onChange={e => {
                      setEmptyH(e.target.value);
                      if (emptyFormatId !== CUSTOM_FORMAT_ID) setEmptyFormatId(CUSTOM_FORMAT_ID);
                    }}
                    aria-label="Alto del frame en píxeles"
                    style={{
                      width: 86, padding: "7px 9px", borderRadius: 8, fontSize: 12,
                      background: "rgba(9,11,18,0.95)", border: "1px solid rgba(99,102,241,0.5)",
                      color: "rgba(255,255,255,0.9)", fontFamily: "inherit", outline: "none",
                    }}
                  />
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginLeft: 4 }}>px</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleCreateFrameAt(0, 0, clampFrameDimension(emptyW), clampFrameDimension(emptyH))}
                  style={{
                    padding: "9px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
                    background: "rgba(99,102,241,0.35)", border: "1px solid rgba(99,102,241,0.6)",
                    color: "#fff", fontFamily: "inherit",
                  }}
                >
                  + Agregar frame
                </button>
                <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.35)" }}>
                  También puedes usar la herramienta Frame (tecla F) y dibujar la medida exacta.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══ Floating Left Toolbar ═══ */}
      <div className="editor-v2-floating-toolbar" data-tour="editor-toolbar" style={{ ...((videoModeOpen || photoModeOpen) ? { display: "none" } : {}), ...toolbarDock.panelStyle(56), ...(toolbarLeft !== undefined ? { left: toolbarLeft } : {}), ...(toolbarDock.state.isDocked ? { transition: "left 0.22s ease" } : {}) }}>
        <div className="dock-handle" {...toolbarDock.handleProps} style={{ justifyContent: "center", padding: "2px 4px", minHeight: 16 }}>
          <span style={{ fontSize: 8, letterSpacing: 2 }}>TOOLS</span>
        </div>
        <FloatingToolbar
          tool={activeTool}
          onToolChange={setActiveTool}
          showShortcuts={showToolbarShortcuts}
          onIconPicker={rect => {
            if (showIconPicker) { setShowIconPicker(false); return; }
            setIconPickerAnchor(rect);
            setIconInsertError("");
            setShowIconPicker(true);
          }}
          foregroundColor={foregroundColor}
          backgroundColor={backgroundColor}
          onForegroundColorChange={setForegroundColor}
          onBackgroundColorChange={setBackgroundColor}
          onSwapColors={handleSwapColors}
          showLayersPanel={showLayersPanel}
          onToggleLayers={() => setShowLayersPanel(v => !v)}
          brushSize={brushSize}
          onBrushSizeChange={setBrushSize}
          wandPrompt={wandPrompt}
          onWandPromptChange={setWandPrompt}
          onWandPromptRun={handleWandPromptRun}
        />
      </div>

      {/* ═══ REQ-045: diálogo numérico de transformación (Enter) ═══ */}
      {numericTransform && (
        <NumericTransformDialog
          initial={numericTransform.initial}
          onApply={handleNumericTransformApply}
          onCancel={() => setNumericTransform(null)}
        />
      )}

      {/* ═══ Onboarding tour (editor steps: canvas, toolbar, layers, props, AI) ═══ */}
      <OnboardingTour
        page="editor"
        onAction={(action) => {
          if (action === "show-layers") setShowLayersPanel(true);
          else if (action === "show-props") setShowRightPanel(true);
          else if (action === "back-to-dashboard") onBack();
        }}
      />

      {/* ═══ Floating Right Properties Panel ═══ */}
      {showRightPanel && !videoModeOpen && !photoModeOpen && (
        <div className="editor-v2-right-panel" data-tour="editor-props" style={{ ...rightDock.panelStyle(rightPanelWidth), width: rightPanelWidth }}>
          {/* Drag the left edge to resize */}
          <div
            onMouseDown={handleRightPanelResizeStart}
            title="Arrastra para cambiar el ancho"
            style={{
              position: "absolute", left: -3, top: 0, bottom: 0, width: 6,
              cursor: "ew-resize", zIndex: 5,
            }}
          />
          <div className="dock-handle" {...rightDock.handleProps}>
            <span>{RIGHT_PANEL_TITLES[rightPanelTab] || "Properties"}</span>
            <button type="button" onClick={() => rightDock.toggleDock("right")} className="dock-pin-btn" title={rightDock.state.isDocked ? "Undock" : "Dock right"}>
              {rightDock.state.isDocked ? "📌" : "📍"}
            </button>
          </div>
          {rightPanelTab === "contextual" && (selectedElement || selectedFrame || selectedOrphanIds.size === 1) && (
            <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
              {(["properties", "code", "animation"] as const).map(t => (
                <button key={t} type="button" onClick={() => setContextualSubTab(t)}
                  style={{
                    flex: 1, padding: "6px 4px", fontSize: 10, textTransform: "capitalize",
                    background: contextualSubTab === t ? "rgba(255,255,255,0.06)" : "transparent",
                    color: contextualSubTab === t ? "#e0e0e0" : "#888",
                    border: "none", borderBottom: contextualSubTab === t ? "2px solid #c8b898" : "2px solid transparent",
                    cursor: "pointer", fontFamily: "inherit",
                  }}>
                  {t}
                </button>
              ))}
            </div>
          )}
          {/* Guía seleccionada — X/Y editable en propiedades, como cualquier
              elemento (fix 5). Mismo ScrubbyInput: tipear + Enter, drag,
              flechas; y botón para borrarla. */}
          {rightPanelTab === "contextual" && selectedGuide && (
            <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#7a7668", letterSpacing: 1, textTransform: "uppercase" }}>
                  Guía {selectedGuide.orientation === "v" ? "vertical" : "horizontal"}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setGuides(gs => gs.filter(g => g.id !== selectedGuide.id));
                    setSelectedGuideId(null);
                  }}
                  title="Eliminar guía (Delete)"
                  style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", padding: 2, fontSize: 11 }}
                >
                  Eliminar
                </button>
              </div>
              <ScrubbyInput
                label={selectedGuide.orientation === "v" ? "X" : "Y"}
                value={String(Math.round(selectedGuide.position))}
                min={-10000}
                max={10000}
                step={1}
                suffix="px"
                onChange={(v) => {
                  const n = parseFloat(v);
                  if (Number.isNaN(n)) return;
                  setGuides(gs => gs.map(g => g.id === selectedGuide.id ? { ...g, position: Math.round(n) } : g));
                }}
              />
            </div>
          )}
          {rightPanelTab === "contextual" && selectedElement && (
            <HtmlContextualPanel
              onOpenVideoMode={() => setVideoModeOpen(true)}
              onOpenPhotoMode={handleOpenPhotoMode}
              workspaceId={templateWorkspaceId}
              element={selectedElement}
              onBooleanOp={handlePathfinder}
              booleanOpReady={multiSelectLayerIds.length >= 2}
              onTraceImage={handleTraceSelectedImage}
              traceBusy={traceBusy}
              alignTargetsCount={Math.max(multiSelectLayerIds.length, crossFrameTargets.length)}
              onAlignSelection={(key) => handleAlign(key === "centerH" ? "center" : key === "centerV" ? "middle" : key)}
              codeToolbar={
                <div style={{ display: "flex", flexWrap: "wrap", gap: 2, alignItems: "center" }}>
                  {/* Align buttons */}
                  <button type="button" onClick={() => handleAlign("left")} title="Align Left"
                    style={elemBtnStyle}><IconAlignLeft size={14} /></button>
                  <button type="button" onClick={() => handleAlign("center")} title="Align Center"
                    style={elemBtnStyle}><IconAlignCenter size={14} /></button>
                  <button type="button" onClick={() => handleAlign("right")} title="Align Right"
                    style={elemBtnStyle}><IconAlignRight size={14} /></button>
                  <div style={sepStyle} />
                  {/* Reorder buttons */}
                  <button type="button" onClick={() => handleReorder("up")} title="Bring Forward"
                    style={elemBtnStyle}>↑</button>
                  <button type="button" onClick={() => handleReorder("down")} title="Send Backward"
                    style={elemBtnStyle}>↓</button>
                  <button type="button" onClick={() => handleReorder("top")} title="Bring to Front"
                    style={elemBtnStyle}>⤒</button>
                  <button type="button" onClick={() => handleReorder("bottom")} title="Send to Back"
                    style={elemBtnStyle}>⤓</button>
                  <div style={sepStyle} />
                  {/* Group button */}
                  <button type="button" onClick={handleGroup} disabled={multiSelectLayerIds.length < 2}
                    title="Group Elements (Ctrl+G)"
                    style={{ ...elemBtnStyle, opacity: multiSelectLayerIds.length < 2 ? 0.4 : 1 }}>Group</button>
                  {/* REQ-027: puntos de entrada visibles para lo que antes
                      sólo vivía en el click derecho (CanvasContextMenu):
                      Ungroup, Lock y la pista de máscara. El orden-Z ya
                      estaba acá (↑ ↓ ⤒ ⤓) y el buscatrazos se enciende vía
                      onBooleanOp/booleanOpReady en el panel. */}
                  <button type="button" onClick={handleUngroup}
                    disabled={selectedElement?.layerKind !== "group"}
                    title="Ungroup (Ctrl+Shift+G)"
                    style={{ ...elemBtnStyle, opacity: selectedElement?.layerKind === "group" ? 1 : 0.4 }}>Ungroup</button>
                  <button type="button" onClick={handleToggleSelectedLock}
                    disabled={!selectedElement}
                    title={selectedIsLocked ? "Unlock layer" : "Lock layer"}
                    style={{ ...elemBtnStyle, opacity: selectedElement ? 1 : 0.4,
                      ...(selectedIsLocked ? { background: "rgba(200,184,152,0.3)", color: "#c8b898" } : {}) }}>
                    {selectedIsLocked ? "Locked" : "Lock"}</button>
                  {/* La máscara real requiere el hit del cursor (un path
                      cerrado DEBAJO del click, ver detectMaskTarget) — un
                      botón no puede replicarlo; queda como pista enseñando
                      el gesto, deshabilitada a propósito. */}
                  <button type="button" disabled
                    title="Máscara: click derecho sobre una imagen con una figura cerrada debajo → «Crear selección»"
                    style={{ ...elemBtnStyle, opacity: 0.4, cursor: "help" }}>Mask</button>
                  <div style={sepStyle} />
                  {/* Copy-as buttons */}
                  <button type="button" onClick={() => handleCopyAs("html")} title="Copy as HTML"
                    style={elemBtnStyle}>HTML</button>
                  <button type="button" onClick={() => handleCopyAs("css")} title="Copy as CSS"
                    style={elemBtnStyle}>CSS</button>
                  <button type="button" onClick={() => handleCopyAs("json")} title="Copy as JSON"
                    style={elemBtnStyle}>JSON</button>
                  <div style={sepStyle} />
                  {/* Smart / Fixed layout toggle */}
                  <button type="button"
                    onClick={() => handleSmartLayout(layoutMode === "fixed" ? "smart" : "fixed")}
                    disabled={mcpLoading === "smart"}
                    title="Toggle smart vs fixed layout"
                    style={{
                      ...elemBtnStyle,
                      background: layoutMode === "smart" ? "rgba(200,184,152,0.3)" : "rgba(255,255,255,0.06)",
                      color: layoutMode === "smart" ? "#a78bfa" : "#ccc",
                      fontWeight: 600,
                    }}>
                    {mcpLoading === "smart" ? "..." : layoutMode === "smart" ? "Smart" : "Fixed"}
                  </button>
                </div>
              }
              selectedLayerIds={multiSelectLayerIds}
              html={activeHtml}
              css={activeCss}
              onCssChange={handleContextualCssChange}
              onSvgFillMedia={handleSvgFillMedia}
              onImageMaskRemove={handleImageMaskRemove}
              onChangeTag={handleChangeTag}
              onCopyStyle={handleCopyStyle}
              onPasteStyle={handlePasteStyle}
              hasClipboardStyle={!!clipboardStyle}
              onConvertToPath={handleConvertToPath}
              onOutlineStroke={handleOutlineStroke}
              onOffsetPath={handleOffsetPath}
              onObjectPathOp={handleObjectPathOp}
              onDistortPath={handleDistortPath}
              onBlendLayers={handleBlendLayers}
              onShapeOptionsChange={handleShapeOptionsChange}
              onShapeVertexRadiusChange={handleShapeVertexRadiusChange}
              onGroupModeChange={handleGroupModeChange}
              onImageSrcChange={handleImageSrcChange}
              onImageRestore={handleImageRestore}
              frameWidth={selectedFrame?.width || 0}
              frameHeight={selectedFrame?.height || 0}
              subTab={contextualSubTab}
              frameAnimation={selectedFrame?.animation ?? null}
              onFrameAnimationChange={selectedFrame ? (next) => handleFrameAnimationChange(selectedFrame.id, next) : undefined}
            />
          )}
          {rightPanelTab === "contextual" && !selectedElement && contextualSubTab === "properties" && (
            selectedFrame ? (
              <div style={{ padding: "4px", display: "flex", flexDirection: "column", gap: 6, overflow: "auto", flex: 1 }}>
                {/* Frame Name */}
                <div style={{ padding: "6px 10px", fontSize: 13, fontWeight: 600, color: "#f0ebe0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  {selectedFrame.name}
                </div>

                {/* Dimensions */}
                <div style={{ padding: "0 10px" }}>
                  <div style={{ fontSize: 10, color: "#7a7668", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Dimensions</div>
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <input
                      type="number"
                      value={selectedFrame.width}
                      onChange={(e) => { const v = Number(e.target.value); if (v >= 10) handleFrameDimensionChange("width", v); }}
                      style={{ flex: 1, background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.05)", color: "#f0ebe0", borderRadius: 4, padding: "3px 6px", fontSize: 11, fontFamily: "monospace", minWidth: 0 }}
                      min={10}
                    />
                    <span style={{ color: "#555", fontSize: 11, flexShrink: 0 }}>×</span>
                    <input
                      type="number"
                      value={selectedFrame.height}
                      onChange={(e) => { const v = Number(e.target.value); if (v >= 10) handleFrameDimensionChange("height", v); }}
                      style={{ flex: 1, background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.05)", color: "#f0ebe0", borderRadius: 4, padding: "3px 6px", fontSize: 11, fontFamily: "monospace", minWidth: 0 }}
                      min={10}
                    />
                  </div>
                </div>

                {/* Background */}
                <div style={{ padding: "0 10px" }}>
                  <div style={{ fontSize: 10, color: "#7a7668", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Background</div>
                  <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                    <input
                      type="color"
                      value={toHexColor(selectedFrame.background)}
                      onChange={(e) => handleFrameBackgroundChange(e.target.value)}
                      style={{ width: 28, height: 24, border: "1px solid rgba(255,255,255,0.06)", borderRadius: 4, cursor: "pointer", padding: 0, flexShrink: 0, background: "none" }}
                    />
                    <input
                      type="text"
                      value={selectedFrame.background || ""}
                      onChange={(e) => handleFrameBackgroundChange(e.target.value)}
                      style={{ flex: 1, background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.05)", color: "#f0ebe0", borderRadius: 4, padding: "3px 6px", fontSize: 11, fontFamily: "monospace", minWidth: 0 }}
                      placeholder="transparent"
                    />
                    <button
                      type="button"
                      onClick={() => handleFrameBackgroundChange("transparent")}
                      style={{ padding: "3px 8px", fontSize: 10, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 4, color: "#888", cursor: "pointer", fontFamily: "inherit" }}
                      title="Make background fully transparent"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={() => { const inp = document.getElementById("__frame_bg_image_input"); inp?.click(); }}
                      style={{ padding: "3px 8px", fontSize: 10, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 4, color: "#888", cursor: "pointer", fontFamily: "inherit" }}
                      title="Upload background image"
                    >
                      🖼
                    </button>
                    <input
                      id="__frame_bg_image_input"
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFrameBackgroundImage(file);
                        e.target.value = "";
                      }}
                    />
                  </div>
                  {/* Quick color swatches */}
                  <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
                    {["#ffffff", "#000000", "#1a1a2e", "#16213e", "#0f3460", "#e94560", "#f5f5f5", "#333333", "#ff6b6b", "#51cf66", "#339af0", "#fcc419"].map(c => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => handleFrameBackgroundChange(c)}
                        style={{ width: 18, height: 18, borderRadius: 3, border: "1px solid rgba(255,255,255,0.1)", background: c, cursor: "pointer", padding: 0, flexShrink: 0 }}
                        title={c}
                      />
                    ))}
                  </div>
                </div>
                
                {/* Modo color del archivo (imprenta): convierte TODOS los frames. */}
                <div style={{ padding: "0 10px", marginTop: 8 }}>
                  <div style={{ fontSize: 10, color: "#7a7668", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Modo color del archivo</div>
                  <button type="button" disabled={fileColorMode === "cmyk" && rgbColorSnapshotRef.current.size === 0} onClick={() => handleConvertFileColors(fileColorMode === "rgb")}
                    style={{ width: "100%", padding: "6px 8px", fontSize: 11, borderRadius: 4,
                      cursor: fileColorMode === "cmyk" && rgbColorSnapshotRef.current.size === 0 ? "not-allowed" : "pointer",
                      opacity: fileColorMode === "cmyk" && rgbColorSnapshotRef.current.size === 0 ? 0.45 : 1,
                      border: "1px solid rgba(200,184,152,0.4)",
                      background: fileColorMode === "cmyk" ? "rgba(200,184,152,0.18)" : "rgba(255,255,255,0.05)",
                      color: "#f0e8d8", fontFamily: "inherit" }}>
                    {fileColorMode === "rgb" ? "Convertir a CMYK (imprenta)" : "Volver a RGB"}
                  </button>
                  <div style={{ fontSize: 9.5, color: "#666", marginTop: 3, lineHeight: 1.4 }}>
                    {fileColorMode === "rgb"
                      ? "Ajusta los colores de todos los frames al gamut CMYK de imprenta. El original queda guardado para volver."
                      : rgbColorSnapshotRef.current.size > 0
                        ? "Restaura los colores RGB originales de cuando se convirtió."
                        : "El modo CMYK persiste para este workspace; el original RGB de una sesión anterior ya no está disponible (usá deshacer)."}
                  </div>
                </div>

                {/* Position (read-only) */}
                <div style={{ padding: "0 10px", fontSize: 10, color: "#555" }}>
                  Position: {selectedFrame.x}, {selectedFrame.y}
                </div>
              </div>
            ) : null
          )}
          {rightPanelTab === "contextual" && !selectedElement && selectedFrame && contextualSubTab === "code" && (
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: 8 }}>
              <CodePanel html={activeHtml} css={activeCss} onHtmlChange={handleHtmlChange} onCssChange={handleCssChange} />
            </div>
          )}
          {rightPanelTab === "contextual" && !selectedElement && selectedFrame && contextualSubTab === "animation" && (
            <AnimationPanel
              frameId={selectedFrame.id}
              frameHtml={selectedFrame.html}
              animation={selectedFrame.animation ?? null}
              onAnimationChange={(next) => handleFrameAnimationChange(selectedFrame.id, next)}
              siblingFrames={frames.filter(f => f.id !== selectedFrame.id).map(f => ({ id: f.id, name: f.name }))}
              onExportVideo={() => handleFrameVideoExport(selectedFrame)}
              exportingVideo={exportingFrameId === selectedFrame.id}
              onOpenVideoMode={() => setVideoModeOpen(true)}
            />
          )}
          {/* ── Orphan (canvas-level object) properties ── */}
          {rightPanelTab === "contextual" && !selectedElement && !selectedFrame && selectedOrphanIds.size === 1 && (() => {
            const orphan = canvasObjects.find(o => selectedOrphanIds.has(o.id));
            if (!orphan) return null;
            const tag = orphan.html.match(/<(\w+)/)?.[1] || "div";
            const selector = `[data-layer-id="${orphan.id}"]`;
            const ruleBlock = getExactRuleDeclarations(orphan.css, selector);
            const declarations = ruleBlock ? parseCssDeclarations(ruleBlock) : [];
            const computedStyles: Record<string, string> = {};
            for (const d of declarations) computedStyles[d.property] = d.value;
            const isSvg = orphan.html.includes("<svg");
            const syntheticElement: SelectedElementInfo = {
              layerId: orphan.id,
              tag,
              selector,
              computedStyles,
              // src del <img> — habilita la sección Fill/Foto del panel para
              // objetos huérfanos de imagen (el \s delante evita data-orig-src).
              src: orphan.html.match(/\ssrc\s*=\s*["']([^"']*)["']/i)?.[1],
              frameId: orphan.id,
              isSvg,
              layerKind: orphan.kind,
              childLayerCount: 0,
              movableLayers: [{ layerId: orphan.id, position: "absolute", left: "0", top: "0", translate: "none", display: "block" }],
            };
            return (
              <HtmlContextualPanel
                onOpenVideoMode={() => setVideoModeOpen(true)}
                onOpenPhotoMode={handleOpenPhotoMode}
                workspaceId={templateWorkspaceId}
                element={syntheticElement}
                html={orphan.html}
                css={orphan.css}
                onCssChange={(newCss) => handleOrphanCssChange(orphan.id, newCss)}
                onSvgFillMedia={handleOrphanSvgFillMedia}
                onChangeTag={(newTag) => handleOrphanTagChange(orphan.id, newTag)}
                onTraceImage={handleTraceSelectedImage}
                traceBusy={traceBusy}
                frameWidth={orphan.width}
                frameHeight={orphan.height}
                subTab={contextualSubTab}
              />
            );
          })()}
          {rightPanelTab === "contextual" && !selectedElement && !selectedFrame && selectedOrphanIds.size === 0 && (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#7a7668", fontSize: 12, padding: 24, textAlign: "center", lineHeight: 1.6 }}>
              Select a frame or element<br />to edit its properties
            </div>
          )}
          {rightPanelTab === "history" && (
            <VersionHistoryPanel templateId={templateId} onRestore={reloadFromServer} />
          )}
          {rightPanelTab === "meta" && (
            <FileInfoPanel
              templateId={templateId}
              onCoverCapture={handleCoverCapture}
              emphasizeCapture={emphasizePreviewCapture}
              onCoverUpdated={handleCoverUpdated}
            />
          )}
          {rightPanelTab === "designSystem" && (
            <DesignSystemPanel
              workspaceId={templateWorkspaceId}
              templateId={templateId}
              templateName={templateName}
              frames={frames.map(f => ({ id: f.id, name: f.name }))}
              selectedFrameIds={selectedFrameIds}
              selectedFrameId={selectedFrameId}
              onToast={(msg, type) => addToast(msg, type || "info")}
              onOpenTemplate={onOpenTemplate}
            />
          )}
          {rightPanelTab === "styleLibrary" && (
            <StyleLibraryPanel
              workspaceId={templateWorkspaceId || "default"}
              onToast={(msg, type) => addToast(msg, type || "info")}
              onPublish={handlePublishStyle}
              publishing={publishingStyle}
              onSaveKeyVisual={handleSaveRecipe}
              saveRecipeMsg={saveRecipeMsg}
              selectedFrameCount={selectedFrameIds.size > 0 ? selectedFrameIds.size : (selectedFrameId ? 1 : 0)}
              templateId={templateId}
              selectedFrameIds={selectedFrameIds}
              onOpenTemplate={onOpenTemplate}
              onAssetUploaded={handleAssetUploaded}
              selectedImageSrc={selectedElement?.src}
              onManageStorage={() => {
                // "storage" stopped being a tab when Diseño gained sub-tabs;
                // it is the Papelera pane now. The old id matched nothing, so
                // this button quietly landed on Archivos instead.
                sessionStorage.setItem("dashboardInitialTab", "diseno");
                sessionStorage.setItem("dashboardInitialPane", "trash");
                setShowRightPanel(false);
                onBack();
              }}
            />
          )}
          {rightPanelTab === "batch" && (
            <BatchAMator
              frames={frames}
              checkedFrameIds={batchCheckedFrameIds}
              onCheckedFrameIdsChange={setBatchCheckedFrameIds}
              onFrameHover={setBatchHoveredFrameId}
              onGenerate={handleBatchGenerate}
              workspaceId={templateWorkspaceId}
              templateId={templateId}
            />
          )}
          {rightPanelTab === "comments" && (
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", fontSize: 12, color: "#d6d0c0" }}>
              {/* Header: pins visibility (desktop toggle) + public state */}
              <div style={{ padding: 10, borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: "#7a7668" }}>Comentarios</span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => setShowComments(v => !v)}
                    title={showComments ? "Ocultar pines del canvas" : "Mostrar pines del canvas"}
                    style={{
                      fontSize: 11, padding: "4px 8px", borderRadius: 6, cursor: "pointer",
                      border: "1px solid rgba(59,130,246,0.4)",
                      background: showComments ? "rgba(59,130,246,0.15)" : "transparent",
                      color: showComments ? "#60a5fa" : "#9ca3af",
                    }}
                  >
                    {showComments ? "Pines visibles" : "Pines ocultos"}
                  </button>
                  <button
                    type="button"
                    onClick={handleTogglePublic}
                    disabled={publicBusy}
                    title={isPublic ? "Toca para hacerlo privado" : "Toca para hacerlo público"}
                    style={{
                      fontSize: 11, padding: "4px 8px", borderRadius: 6, cursor: "pointer",
                      border: "1px solid rgba(255,255,255,0.12)", background: "transparent",
                      color: isPublic ? "#34d399" : "#f87171",
                    }}
                  >
                    {publicBusy ? "…" : isPublic ? "Público" : "Privado"}
                  </button>
                </div>
              </div>

              {/* List */}
              <div style={{ flex: 1, overflowY: "auto", padding: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                {comments.length === 0 && (
                  <p style={{ textAlign: "center", color: "#7a7668", padding: 24, lineHeight: 1.6, margin: 0 }}>
                    Todavía no hay comentarios.<br />
                    Comparte el enlace para que otros dejen feedback, o haz doble clic en el canvas para dejar un pin tú mismo.
                  </p>
                )}
                {comments.map(c => {
                  return (
                    <div
                      key={c.id}
                      className={highlightCommentId === c.id ? "editor-v2-comment-row-highlight" : ""}
                      style={{ padding: 8, borderRadius: 8, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
                        <strong style={{ fontSize: 11 }}>{c.authorName}</strong>
                        <span style={{ fontSize: 10, color: "#7a7668" }}>
                          {new Date(c.createdAt).toLocaleDateString("es", { day: "numeric", month: "short" })}
                          {c.source === "editor_pin" ? " · editor" : " · invitado"}
                        </span>
                        {c.status !== "open" && (
                          <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 6, background: "rgba(156,163,175,0.2)", color: "#9CA3AF" }}>Resuelto</span>
                        )}
                      </div>
                      <p style={{ margin: "0 0 8px", fontSize: 12, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{c.body}</p>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          disabled={!!c.kanbanTaskId}
                          onClick={() => handleCommentToKanban(c.id)}
                          title={c.kanbanTaskId ? "Ya está en el Kanban" : "Crea una tarea en el Kanban con este comentario"}
                          style={{
                            fontSize: 11, padding: "4px 8px", borderRadius: 6,
                            border: "1px solid rgba(59,130,246,0.4)",
                            background: c.kanbanTaskId ? "transparent" : "rgba(59,130,246,0.12)",
                            color: c.kanbanTaskId ? "#6b7280" : "#60a5fa",
                            cursor: c.kanbanTaskId ? "default" : "pointer",
                          }}
                        >
                          {c.kanbanTaskId ? "En Kanban" : "Al Kanban"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleResolveComment(c.id, c.status === "open" ? "resolved" : "open")}
                          style={{ fontSize: 11, padding: "4px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "#9ca3af", cursor: "pointer" }}
                        >
                          {c.status === "open" ? "Resolver" : "Reabrir"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteComment(c.id)}
                          style={{ fontSize: 11, padding: "4px 8px", borderRadius: 6, border: "1px solid rgba(239,68,68,0.3)", background: "transparent", color: "#f87171", cursor: "pointer" }}
                        >
                          Eliminar
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {rightPanelTab === "ai" && (
            <div style={{ padding: 12, overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
              {/* ── Google Gemini (image-to-design) ── */}
              <div>
                <div style={{ fontSize: 10, color: "#7a7668", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Image → Design (Google Gemini)</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div>
                    <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 4 }}>Modelo</label>
                    <select
                      value={geminiModel}
                      onChange={e => {
                        if (geminiConfigured) {
                          saveProviderKey("google", "", e.target.value).then(refreshKeyStatuses).catch(() => {});
                        }
                      }}
                      style={{ width: "100%", boxSizing: "border-box", padding: "6px 10px", fontSize: 12, background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.08)", color: "#f0ebe0", borderRadius: 4, outline: "none", cursor: "pointer" }}
                    >
                      {geminiProvider.models.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 4 }}>API Key</label>
                    <div style={{ display: "flex", gap: 6 }}>
                      <input
                        type="password"
                        value={geminiKeyDraft}
                        onChange={e => setGeminiKeyDraft(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter" && geminiKeyDraft.trim()) handleSaveGeminiKey(geminiKeyDraft.trim());
                          if (e.key === "Escape") setGeminiKeyDraft("");
                        }}
                        placeholder="AIza... (Google Gemini API key)"
                        style={{ flex: 1, minWidth: 0, padding: "6px 10px", fontSize: 12, fontFamily: "monospace", background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.08)", color: "#f0ebe0", borderRadius: 4, outline: "none" }}
                      />
                      <button
                        type="button"
                        disabled={!geminiKeyDraft.trim() || keySaving}
                        onClick={() => handleSaveGeminiKey(geminiKeyDraft.trim())}
                        style={{ padding: "6px 14px", fontSize: 12, fontWeight: 500, border: "none", borderRadius: 4, cursor: geminiKeyDraft.trim() && !keySaving ? "pointer" : "not-allowed", background: geminiKeyDraft.trim() && !keySaving ? "rgba(200,184,152,0.2)" : "rgba(255,255,255,0.03)", color: geminiKeyDraft.trim() && !keySaving ? "#c8b898" : "#555", whiteSpace: "nowrap", fontFamily: "inherit" }}
                      >
                        Guardar
                      </button>
                    </div>
                    {geminiConfigured ? (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
                        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>🔒 Cifrada en servidor · {geminiModel}</span>
                        <button type="button" onClick={() => handleSaveGeminiKey("")} style={{ fontSize: 11, border: "none", background: "transparent", color: "#f87171", cursor: "pointer", padding: 0 }}>Eliminar</button>
                      </div>
                    ) : (
                      <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "#818cf8", textDecoration: "none", display: "inline-block", marginTop: 4 }}>
                        Obtener key gratis ↗
                      </a>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Quiver AI (vectorize) ── */}
              <div>
                <div style={{ fontSize: 10, color: "#7a7668", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Vectorize Image → SVG (Quiver AI)</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div>
                    <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 4 }}>Modelo</label>
                    <select
                      value={quiverModel}
                      onChange={e => {
                        if (quiverConfigured) {
                          saveProviderKey("quiver", "", e.target.value).then(refreshKeyStatuses).catch(() => {});
                        }
                      }}
                      style={{ width: "100%", boxSizing: "border-box", padding: "6px 10px", fontSize: 12, background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.08)", color: "#f0ebe0", borderRadius: 4, outline: "none", cursor: "pointer" }}
                    >
                      {quiverProvider.models.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 4 }}>API Key</label>
                    <div style={{ display: "flex", gap: 6 }}>
                      <input
                        type="password"
                        value={quiverKeyDraft}
                        onChange={e => setQuiverKeyDraft(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter" && quiverKeyDraft.trim()) handleSaveQuiverKey(quiverKeyDraft.trim());
                          if (e.key === "Escape") setQuiverKeyDraft("");
                        }}
                        placeholder="qv_... (Quiver AI API key)"
                        style={{ flex: 1, minWidth: 0, padding: "6px 10px", fontSize: 12, fontFamily: "monospace", background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.08)", color: "#f0ebe0", borderRadius: 4, outline: "none" }}
                      />
                      <button
                        type="button"
                        disabled={!quiverKeyDraft.trim() || keySaving}
                        onClick={() => handleSaveQuiverKey(quiverKeyDraft.trim())}
                        style={{ padding: "6px 14px", fontSize: 12, fontWeight: 500, border: "none", borderRadius: 4, cursor: quiverKeyDraft.trim() && !keySaving ? "pointer" : "not-allowed", background: quiverKeyDraft.trim() && !keySaving ? "rgba(200,184,152,0.2)" : "rgba(255,255,255,0.03)", color: quiverKeyDraft.trim() && !keySaving ? "#c8b898" : "#555", whiteSpace: "nowrap", fontFamily: "inherit" }}
                      >
                        Guardar
                      </button>
                    </div>
                    {quiverConfigured ? (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
                        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>🔒 Cifrada en servidor · {quiverModel}</span>
                        <button type="button" onClick={() => handleSaveQuiverKey("")} style={{ fontSize: 11, border: "none", background: "transparent", color: "#f87171", cursor: "pointer", padding: 0 }}>Eliminar</button>
                      </div>
                    ) : (
                      <a href="https://quiver.ai" target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "#818cf8", textDecoration: "none", display: "inline-block", marginTop: 4 }}>
                        Obtener key ↗
                      </a>
                    )}
                  </div>
                </div>
              </div>

              {/* ── WaveSpeedAI (Seedream layer separation) ── */}
              <div>
                <div style={{ fontSize: 10, color: "#7a7668", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Separar en Capas (WaveSpeedAI · Seedream)</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div>
                    <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 4 }}>Modelo</label>
                    <select
                      value={wavespeedModel}
                      onChange={e => {
                        if (wavespeedConfigured) {
                          saveProviderKey("wavespeed", "", e.target.value).then(refreshKeyStatuses).catch(() => {});
                        }
                      }}
                      style={{ width: "100%", boxSizing: "border-box", padding: "6px 10px", fontSize: 12, background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.08)", color: "#f0ebe0", borderRadius: 4, outline: "none", cursor: "pointer" }}
                    >
                      {wavespeedProvider.models.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 4 }}>API Key</label>
                    <div style={{ display: "flex", gap: 6 }}>
                      <input
                        type="password"
                        value={wavespeedKeyDraft}
                        onChange={e => setWavespeedKeyDraft(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter" && wavespeedKeyDraft.trim()) handleSaveWavespeedKey(wavespeedKeyDraft.trim());
                          if (e.key === "Escape") setWavespeedKeyDraft("");
                        }}
                        placeholder="API key de wavespeed.ai/accesskey"
                        style={{ flex: 1, minWidth: 0, padding: "6px 10px", fontSize: 12, fontFamily: "monospace", background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.08)", color: "#f0ebe0", borderRadius: 4, outline: "none" }}
                      />
                      <button
                        type="button"
                        disabled={!wavespeedKeyDraft.trim() || keySaving}
                        onClick={() => handleSaveWavespeedKey(wavespeedKeyDraft.trim())}
                        style={{ padding: "6px 14px", fontSize: 12, fontWeight: 500, border: "none", borderRadius: 4, cursor: wavespeedKeyDraft.trim() && !keySaving ? "pointer" : "not-allowed", background: wavespeedKeyDraft.trim() && !keySaving ? "rgba(200,184,152,0.2)" : "rgba(255,255,255,0.03)", color: wavespeedKeyDraft.trim() && !keySaving ? "#c8b898" : "#555", whiteSpace: "nowrap", fontFamily: "inherit" }}
                      >
                        Guardar
                      </button>
                    </div>
                    {wavespeedConfigured ? (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
                        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>🔒 Cifrada en servidor · compartida con 🧅 Separar en Capas</span>
                        <button type="button" onClick={() => handleSaveWavespeedKey("")} style={{ fontSize: 11, border: "none", background: "transparent", color: "#f87171", cursor: "pointer", padding: 0 }}>Eliminar</button>
                      </div>
                    ) : (
                      <a href="https://wavespeed.ai/accesskey" target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "#818cf8", textDecoration: "none", display: "inline-block", marginTop: 4 }}>
                        Obtener key ↗
                      </a>
                    )}
                  </div>
                </div>
              </div>

              {/* ── RunwayML (video generation) ── */}
              <div>
                <div style={{ fontSize: 10, color: "#7a7668", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Generar Video (RunwayML)</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div>
                    <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 4 }}>Modelo</label>
                    <select
                      value={videoModel}
                      onChange={e => {
                        setVideoModel(e.target.value);
                        localStorage.setItem(VIDEO_GEN_MODEL_SLOT, e.target.value);
                        if (runwayConfigured) {
                          saveProviderKey("runway", "", e.target.value).then(refreshKeyStatuses).catch(() => {});
                        }
                      }}
                      style={{ width: "100%", boxSizing: "border-box", padding: "6px 10px", fontSize: 12, background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.08)", color: "#f0ebe0", borderRadius: 4, outline: "none", cursor: "pointer" }}
                    >
                      {VIDEO_GEN_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 4 }}>API Key</label>
                    <div style={{ display: "flex", gap: 6 }}>
                      <input
                        type="password"
                        value={runwayKeyDraft}
                        onChange={e => setRunwayKeyDraft(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter" && runwayKeyDraft.trim()) handleSaveRunwayKey(runwayKeyDraft.trim());
                          if (e.key === "Escape") setRunwayKeyDraft("");
                        }}
                        placeholder="API key de dev.runwayml.com"
                        style={{ flex: 1, minWidth: 0, padding: "6px 10px", fontSize: 12, fontFamily: "monospace", background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.08)", color: "#f0ebe0", borderRadius: 4, outline: "none" }}
                      />
                      <button
                        type="button"
                        disabled={!runwayKeyDraft.trim() || keySaving}
                        onClick={() => handleSaveRunwayKey(runwayKeyDraft.trim())}
                        style={{ padding: "6px 14px", fontSize: 12, fontWeight: 500, border: "none", borderRadius: 4, cursor: runwayKeyDraft.trim() && !keySaving ? "pointer" : "not-allowed", background: runwayKeyDraft.trim() && !keySaving ? "rgba(200,184,152,0.2)" : "rgba(255,255,255,0.03)", color: runwayKeyDraft.trim() && !keySaving ? "#c8b898" : "#555", whiteSpace: "nowrap", fontFamily: "inherit" }}
                      >
                        Guardar
                      </button>
                    </div>
                    {runwayConfigured ? (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
                        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>🔒 Cifrada en servidor · solo para video</span>
                        <button type="button" onClick={() => handleSaveRunwayKey("")} style={{ fontSize: 11, border: "none", background: "transparent", color: "#f87171", cursor: "pointer", padding: 0 }}>Eliminar</button>
                      </div>
                    ) : (
                      <a href="https://dev.runwayml.com" target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "#818cf8", textDecoration: "none", display: "inline-block", marginTop: 4 }}>
                        Obtener key ↗
                      </a>
                    )}
                  </div>
                </div>
              </div>

              <div style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />

              {/* ── Chat LLM (all providers) ── */}
              <div>
                <div style={{ fontSize: 10, color: "#7a7668", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Chat LLM (todos los proveedores)</div>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", lineHeight: 1.6, marginBottom: 10 }}>
                  La key del chat se configura en el panel del chat (botón 💬). Aquí solo se muestra qué modelos hay disponibles por proveedor.
                </p>
                {AI_PROVIDERS.filter(p => p.id !== "google" && p.id !== "quiver" && p.id !== "wavespeed" && p.id !== "runway").map(p => (
                  <div key={p.id} style={{ marginBottom: 10, padding: "8px 10px", background: "rgba(255,255,255,0.02)", borderRadius: 6, border: "1px solid rgba(255,255,255,0.04)" }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.7)", marginBottom: 4 }}>{p.label}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {p.models.map(m => (
                        <span key={m} style={{ fontSize: 10, padding: "2px 6px", borderRadius: 3, background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>{m}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {rightPanelTab === "genImage" && (() => {
            const src = resolveSelectedImage();
            return (
              <div style={{ padding: 12, overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 14, fontSize: 12, color: "#d6d0c0" }}>
                {/* Mode: live indicator of what the next generation will do */}
                <div style={{ padding: "8px 10px", borderRadius: 8, background: src ? "rgba(245,158,11,0.08)" : "rgba(255,255,255,0.03)", border: `1px solid ${src ? "rgba(245,158,11,0.35)" : "rgba(255,255,255,0.08)"}`, display: "flex", alignItems: "center", gap: 8 }}>
                  {src ? (
                    <>
                      <img src={src.url} alt="" style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 6, border: "1px solid rgba(245,158,11,0.4)" }} />
                      <div>
                        <div style={{ color: "#fbbf24", fontWeight: 600 }}>🎨 Editar imagen seleccionada</div>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>La imagen actúa de referencia y tu prompt indica el cambio. El resultado aparece al lado, nunca encima.</div>
                      </div>
                    </>
                  ) : (
                    <div>
                      <div style={{ color: "#c8b898", fontWeight: 600 }}>✨ Crear imagen desde cero</div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>Seleccioná una imagen en el editor si querés editarla; sin selección se genera una nueva.</div>
                    </div>
                  )}
                </div>

                {/* Prompt */}
                <div>
                  <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 4 }}>Prompt</label>
                  <textarea
                    value={nbPrompt}
                    onChange={e => setNbPrompt(e.target.value)}
                    placeholder={src ? "Ej: cambiá el fondo a un atardecer y mantené el producto" : "Ej: poster minimalista de café sobre fondo beige, luz suave, estilo editorial"}
                    rows={4}
                    style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", fontSize: 12, fontFamily: "inherit", background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.08)", color: "#f0ebe0", borderRadius: 4, outline: "none", resize: "vertical" }}
                  />
                </div>

                {/* Output format: Gemini presets + custom size snapping */}
                <div>
                  <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 4 }}>Formato de salida</label>
                  <select
                    value={nbAspect}
                    onChange={e => {
                      setNbAspect(e.target.value);
                      try { localStorage.setItem(NANO_BANANA_ASPECT_SLOT, e.target.value); } catch { /* modo privado */ }
                    }}
                    style={{ width: "100%", boxSizing: "border-box", padding: "6px 10px", fontSize: 12, background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.08)", color: "#f0ebe0", borderRadius: 4, outline: "none", cursor: "pointer" }}
                  >
                    <option value="">Auto — el modelo decide</option>
                    {NANO_BANANA_ASPECTS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
                    <option value="custom">Personalizado…</option>
                  </select>
                  {nbAspect === "custom" && (() => {
                    const cw = parseInt(nbCustomW, 10);
                    const ch = parseInt(nbCustomH, 10);
                    const valid = cw > 0 && ch > 0;
                    const snap = valid ? nearestNanoBananaAspect(cw, ch) : "";
                    const inputStyle = { width: 72, padding: "5px 8px", fontSize: 12, background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.08)", color: "#f0ebe0", borderRadius: 4, outline: "none" } as const;
                    const chipStyle = { padding: "3px 8px", fontSize: 10, border: "1px solid rgba(255,255,255,0.12)", borderRadius: 4, cursor: "pointer", background: "rgba(255,255,255,0.05)", color: "#c8b898", fontFamily: "inherit" } as const;
                    return (
                      <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                        <input type="number" min={16} max={4096} value={nbCustomW} onChange={e => setNbCustomW(e.target.value)} placeholder="Ancho" style={inputStyle} />
                        <span style={{ color: "rgba(255,255,255,0.3)" }}>×</span>
                        <input type="number" min={16} max={4096} value={nbCustomH} onChange={e => setNbCustomH(e.target.value)} placeholder="Alto" style={inputStyle} />
                        <span style={{ fontSize: 10, color: valid ? "#7a7668" : "#fbbf24" }}>
                          {valid ? `px → se genera en ${snap}` : "Ingresá ancho y alto en px"}
                        </span>
                        <div style={{ display: "flex", gap: 4, width: "100%" }}>
                          <button type="button" onClick={() => { setNbCustomW("2480"); setNbCustomH("3508"); }} style={chipStyle}>A4 vertical</button>
                          <button type="button" onClick={() => { setNbCustomW("3508"); setNbCustomH("2480"); }} style={chipStyle}>A4 horizontal</button>
                        </div>
                      </div>
                    );
                  })()}
                  <div style={{ fontSize: 10, color: "#7a7668", marginTop: 4 }}>
                    Gemini genera en 10 formatos; un tamaño custom (ej. 1350×1080, A4) usa el más cercano.
                  </div>
                </div>

                {/* Fidelity: strict charter toggle + temperature */}
                <div>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#d6d0c0", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={nbStrict !== "0"}
                      onChange={e => {
                        const v = e.target.checked ? "1" : "0";
                        setNbStrict(v);
                        try { localStorage.setItem(NANO_BANANA_STRICT_SLOT, v); } catch { /* modo privado */ }
                      }}
                      style={{ accentColor: "#f59e0b" }}
                    />
                    <span>Modo estricto — no inventar elementos</span>
                  </label>
                  <div style={{ fontSize: 10, color: "#7a7668", marginTop: 4 }}>
                    Al editar: reproduce la referencia fielmente y aplica solo tu cambio; si cambia el formato, extiende el fondo. Desactivalo solo para ediciones creativas.
                  </div>

                  <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "block", margin: "10px 0 4px" }}>Temperatura</label>
                  <select
                    value={nbTemp}
                    onChange={e => {
                      setNbTemp(e.target.value);
                      try { localStorage.setItem(NANO_BANANA_TEMP_SLOT, e.target.value); } catch { /* modo privado */ }
                    }}
                    style={{ width: "100%", boxSizing: "border-box", padding: "6px 10px", fontSize: 12, background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.08)", color: "#f0ebe0", borderRadius: 4, outline: "none", cursor: "pointer" }}
                  >
                    <option value="">Auto — estándar (recomendado)</option>
                    <option value="0">0 — Quirúrgico</option>
                    <option value="0.25">0.25 — Estándar de ediciones</option>
                    <option value="0.5">0.5 — Equilibrado</option>
                    <option value="0.75">0.75 — Creativo</option>
                    <option value="1">1 — Muy creativo</option>
                  </select>
                  <div style={{ fontSize: 10, color: "#7a7668", marginTop: 4 }}>
                    Estándar: Auto = 0.25 al editar (menos alucinaciones) y el default del modelo al crear. Menor = respeta más la imagen; mayor = más creatividad.
                  </div>
                </div>

                {/* Nano Banana version */}
                <div>
                  <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 4 }}>Versión de Nano Banana</label>
                  <select
                    value={nbModel}
                    onChange={e => {
                      setNbModel(e.target.value);
                      localStorage.setItem(NANO_BANANA_MODEL_SLOT, e.target.value);
                      saveUserPrefs({ nanoBananaModel: e.target.value }).catch(() => { /* best-effort */ });
                    }}
                    style={{ width: "100%", boxSizing: "border-box", padding: "6px 10px", fontSize: 12, background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.08)", color: "#f0ebe0", borderRadius: 4, outline: "none", cursor: "pointer" }}
                  >
                    {NANO_BANANA_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                  <div style={{ fontSize: 10, color: "#7a7668", marginTop: 4 }}>
                    Usa la misma API key de Gemini que Image to Design.
                  </div>
                </div>

                {/* Key status — the editable surface lives in Ajustes de IA */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 10px", borderRadius: 8, background: geminiConfigured ? "rgba(52,211,153,0.05)" : "rgba(251,191,36,0.05)", border: `1px solid ${geminiConfigured ? "rgba(52,211,153,0.22)" : "rgba(251,191,36,0.28)"}` }}>
                  <span style={{ fontSize: 11, color: geminiConfigured ? "#6ee7b7" : "#fbbf24" }}>
                    {geminiConfigured ? "✓ Clave de Gemini configurada" : "Falta tu clave de Gemini"}
                  </span>
                  <button type="button" onClick={openAiConfigPanel} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 500, border: "1px solid rgba(255,255,255,0.12)", borderRadius: 4, cursor: "pointer", background: "rgba(255,255,255,0.05)", color: "#c8b898", whiteSpace: "nowrap", fontFamily: "inherit", flexShrink: 0 }}>
                    Abrir Ajustes de IA
                  </button>
                </div>

                {/* Generate */}
                <button
                  type="button"
                  disabled={!nbPrompt.trim() || mcpLoading === "genImage"}
                  onClick={handleGenerateNanoBanana}
                  style={{ padding: "9px 12px", fontSize: 12, fontWeight: 600, border: "1px solid rgba(245,158,11,0.3)", borderRadius: 6, cursor: nbPrompt.trim() && mcpLoading !== "genImage" ? "pointer" : "not-allowed", background: nbPrompt.trim() && mcpLoading !== "genImage" ? "linear-gradient(135deg, rgba(251,191,36,0.25), rgba(245,158,11,0.25))" : "rgba(255,255,255,0.03)", color: nbPrompt.trim() && mcpLoading !== "genImage" ? "#fbbf24" : "#555", fontFamily: "inherit" }}
                >
                  {mcpLoading === "genImage" ? "Generando…" : src ? "🍌 Generar edición" : "🍌 Generar imagen"}
                </button>
              </div>
            );
          })()}
          {rightPanelTab === "layerSplit" && (() => {
            const src = resolveSelectedImage();
            const busy = splitStatus !== "idle";
            const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
            return (
              <div style={{ padding: 12, overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 14, fontSize: 12, color: "#d6d0c0" }}>
                {/* Mode: an image selection is required — there is no
                    from-scratch mode for layer separation */}
                <div style={{ padding: "8px 10px", borderRadius: 8, background: src ? "rgba(99,102,241,0.08)" : "rgba(255,255,255,0.03)", border: `1px solid ${src ? "rgba(99,102,241,0.35)" : "rgba(255,255,255,0.08)"}`, display: "flex", alignItems: "center", gap: 8 }}>
                  {src ? (
                    <>
                      <img src={src.url} alt="" style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 6, border: "1px solid rgba(99,102,241,0.4)" }} />
                      <div>
                        <div style={{ color: "#a5b4fc", fontWeight: 600 }}>🧅 Separar imagen seleccionada</div>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>Seedream la descompone en fondo + capas transparentes, en un frame al lado de la original.</div>
                      </div>
                    </>
                  ) : (
                    <div>
                      <div style={{ color: "#c8b898", fontWeight: 600 }}>Seleccioná una imagen</div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>Elegí una imagen del editor para separarla en capas editables (fuentes, fotos, elementos).</div>
                    </div>
                  )}
                </div>

                {/* Optional layer-guide prompt */}
                <div>
                  <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 4 }}>Prompt (opcional)</label>
                  <textarea
                    value={splitPrompt}
                    onChange={e => setSplitPrompt(e.target.value)}
                    placeholder="Vacío = detección automática. Ej: separá el titular, el logo y el producto del fondo"
                    rows={3}
                    style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", fontSize: 12, fontFamily: "inherit", background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.08)", color: "#f0ebe0", borderRadius: 4, outline: "none", resize: "vertical" }}
                  />
                </div>

                {/* Model / resolution / speed */}
                <div>
                  <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 4 }}>Modelo (WaveSpeedAI)</label>
                  <select
                    value={splitModel}
                    onChange={e => {
                      setSplitModel(e.target.value);
                      localStorage.setItem(LAYER_SPLIT_MODEL_SLOT, e.target.value);
                      if (wavespeedConfigured) {
                        saveProviderKey("wavespeed", "", e.target.value).then(refreshKeyStatuses).catch(() => {});
                      }
                    }}
                    style={{ width: "100%", boxSizing: "border-box", padding: "6px 10px", fontSize: 12, background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.08)", color: "#f0ebe0", borderRadius: 4, outline: "none", cursor: "pointer" }}
                  >
                    {LAYER_SPLIT_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div>
                    <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 4 }}>Resolución</label>
                    <select
                      value={splitResolution}
                      onChange={e => {
                        setSplitResolution(e.target.value);
                        localStorage.setItem(LAYER_SPLIT_RES_SLOT, e.target.value);
                      }}
                      style={{ width: "100%", boxSizing: "border-box", padding: "6px 10px", fontSize: 12, background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.08)", color: "#f0ebe0", borderRadius: 4, outline: "none", cursor: "pointer" }}
                    >
                      {LAYER_SPLIT_RESOLUTIONS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 4 }}>Velocidad</label>
                    <select
                      value={splitSpeed}
                      onChange={e => {
                        const v = e.target.value === "standard" ? "standard" : "fast";
                        setSplitSpeed(v);
                        localStorage.setItem(LAYER_SPLIT_SPEED_SLOT, v);
                      }}
                      style={{ width: "100%", boxSizing: "border-box", padding: "6px 10px", fontSize: 12, background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.08)", color: "#f0ebe0", borderRadius: 4, outline: "none", cursor: "pointer" }}
                    >
                      <option value="fast">Fast — más rápido</option>
                      <option value="standard">Standard — más preciso</option>
                    </select>
                  </div>
                </div>
                <div style={{ fontSize: 10, color: "#7a7668", lineHeight: 1.5 }}>
                  Cada separación consume créditos de tu cuenta WaveSpeed (~$0.77 en 1k/1.5k, ~$1.53 en 2k) y tarda 1-2 min. Las capas quedan como imágenes propias en tu biblioteca.
                </div>

                {/* Key status — the editable surface lives in Ajustes de IA */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 10px", borderRadius: 8, background: wavespeedConfigured ? "rgba(52,211,153,0.05)" : "rgba(251,191,36,0.05)", border: `1px solid ${wavespeedConfigured ? "rgba(52,211,153,0.22)" : "rgba(251,191,36,0.28)"}` }}>
                  <span style={{ fontSize: 11, color: wavespeedConfigured ? "#6ee7b7" : "#fbbf24" }}>
                    {wavespeedConfigured ? "✓ Clave de WaveSpeed configurada" : "Falta tu clave de WaveSpeed"}
                  </span>
                  <button type="button" onClick={openAiConfigPanel} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 500, border: "1px solid rgba(255,255,255,0.12)", borderRadius: 4, cursor: "pointer", background: "rgba(255,255,255,0.05)", color: "#c8b898", whiteSpace: "nowrap", fontFamily: "inherit", flexShrink: 0 }}>
                    Abrir Ajustes de IA
                  </button>
                </div>

                {/* Live progress: countdown to the median ETA + spaced real
                    checks (the ones that actually decide completion) */}
                {busy && (
                  <div style={{ padding: 12, borderRadius: 8, background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.3)", textAlign: "center" }}>
                    {splitStatus === "submitting" && (
                      <div style={{ color: "#a5b4fc" }}>🧅 Enviando imagen…</div>
                    )}
                    {splitStatus === "processing" && (<>
                      <div style={{ fontSize: 22, fontWeight: 700, color: "#a5b4fc", fontFamily: "SF Mono, monospace" }}>
                        {splitEtaLeft > 0 ? `~${fmt(splitEtaLeft)}` : "⏳"}
                      </div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginTop: 2 }}>
                        {splitEtaLeft > 0 ? "tiempo estimado restante" : "está tardando más de lo usual — sigue trabajando"}
                      </div>
                      <div style={{ fontSize: 10, color: "#7a7668", marginTop: 4 }}>Rechequeo automático en {fmt(Math.max(0, splitNextCheck))}</div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 4 }}>Podés seguir editando mientras.</div>
                    </>)}
                    {splitStatus === "uploading" && (
                      <div style={{ color: "#a5b4fc" }}>📥 Ubicando y guardando capas…</div>
                    )}
                  </div>
                )}

                {/* Generate */}
                <button
                  type="button"
                  disabled={!src || busy || !wavespeedConfigured}
                  onClick={handleSeparateLayers}
                  style={{ padding: "9px 12px", fontSize: 12, fontWeight: 600, border: "1px solid rgba(99,102,241,0.3)", borderRadius: 6, cursor: src && !busy && wavespeedConfigured ? "pointer" : "not-allowed", background: src && !busy && wavespeedConfigured ? "linear-gradient(135deg, rgba(99,102,241,0.25), rgba(79,70,229,0.25))" : "rgba(255,255,255,0.03)", color: src && !busy && wavespeedConfigured ? "#a5b4fc" : "#555", fontFamily: "inherit" }}
                >
                  {busy ? "Separando…" : "🧅 Separar en capas"}
                </button>
              </div>
            );
          })()}

          {rightPanelTab === "videoGen" && (() => {
            const src = resolveSelectedImage();
            const busy = videoStatus !== "idle";
            const ready = videoMode === "text" ? !!videoPrompt.trim() : !!src;
            const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
            return (
              <div style={{ padding: 12, overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 14, fontSize: 12, color: "#d6d0c0" }}>
                {/* Mode toggle: animate a selected image OR generate from prompt alone */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  {([["image", "🖼️ Animar imagen"], ["text", "✍️ Solo texto"]] as const).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setVideoMode(mode)}
                      style={{ padding: "7px 8px", fontSize: 12, fontWeight: videoMode === mode ? 600 : 400, border: `1px solid ${videoMode === mode ? "rgba(236,72,153,0.45)" : "rgba(255,255,255,0.08)"}`, borderRadius: 6, cursor: "pointer", background: videoMode === mode ? "rgba(236,72,153,0.12)" : "rgba(255,255,255,0.03)", color: videoMode === mode ? "#f9a8d4" : "#9a958a", fontFamily: "inherit" }}
                    >{label}</button>
                  ))}
                </div>
                {videoMode === "image" ? (
                  <div style={{ padding: "8px 10px", borderRadius: 8, background: src ? "rgba(236,72,153,0.08)" : "rgba(255,255,255,0.03)", border: `1px solid ${src ? "rgba(236,72,153,0.35)" : "rgba(255,255,255,0.08)"}`, display: "flex", alignItems: "center", gap: 8 }}>
                    {src ? (
                      <>
                        <img src={src.url} alt="" style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 6, border: "1px solid rgba(236,72,153,0.4)" }} />
                        <div>
                          <div style={{ color: "#f9a8d4", fontWeight: 600 }}>🎬 Animar imagen seleccionada</div>
                          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>Runway genera un video de la imagen, en un frame al lado. Se reproduce y se descarga como mp4.</div>
                        </div>
                      </>
                    ) : (
                      <div>
                        <div style={{ color: "#c8b898", fontWeight: 600 }}>Seleccioná una imagen</div>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>Elegí una imagen del editor para convertirla en video con IA.</div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ padding: "8px 10px", borderRadius: 8, background: "rgba(168,85,247,0.08)", border: "1px solid rgba(168,85,247,0.3)" }}>
                    <div style={{ color: "#d8b4fe", fontWeight: 600 }}>✍️ Runway inventa toda la escena</div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>No necesita imagen: describí sujeto, ambiente, movimiento, cámara y estilo, y el video se genera desde cero.</div>
                  </div>
                )}

                {/* Motion prompt */}
                <div>
                  <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 4 }}>
                    {videoMode === "text" ? "Prompt de escena (obligatorio)" : "Prompt de movimiento (opcional)"}
                  </label>
                  <textarea
                    value={videoPrompt}
                    onChange={e => setVideoPrompt(e.target.value)}
                    placeholder={videoMode === "text"
                      ? "Ej: un zorro rojo cruzando un bosque nevado al amanecer, cámara siguiéndolo a ras de suelo, luz suave, estilo cinematográfico"
                      : "Vacío = la IA decide. Ej: la cámara acercándose lentamente, el humo en movimiento, luz de atardecer"}
                    rows={3}
                    style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", fontSize: 12, fontFamily: "inherit", background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.08)", color: "#f0ebe0", borderRadius: 4, outline: "none", resize: "vertical" }}
                  />
                </div>

                {/* Model / ratio / duration */}
                <div>
                  <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 4 }}>Modelo (RunwayML)</label>
                  <select
                    value={videoModel}
                    onChange={e => {
                      setVideoModel(e.target.value);
                      localStorage.setItem(VIDEO_GEN_MODEL_SLOT, e.target.value);
                      if (runwayConfigured) {
                        saveProviderKey("runway", "", e.target.value).then(refreshKeyStatuses).catch(() => {});
                      }
                    }}
                    style={{ width: "100%", boxSizing: "border-box", padding: "6px 10px", fontSize: 12, background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.08)", color: "#f0ebe0", borderRadius: 4, outline: "none", cursor: "pointer" }}
                  >
                    {VIDEO_GEN_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div>
                    <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 4 }}>Formato</label>
                    <select
                      value={videoRatio}
                      onChange={e => {
                        setVideoRatio(e.target.value);
                        localStorage.setItem(VIDEO_GEN_RATIO_SLOT, e.target.value);
                      }}
                      style={{ width: "100%", boxSizing: "border-box", padding: "6px 10px", fontSize: 12, background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.08)", color: "#f0ebe0", borderRadius: 4, outline: "none", cursor: "pointer" }}
                    >
                      {VIDEO_GEN_RATIOS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 4 }}>Duración</label>
                    <select
                      value={String(videoDuration)}
                      onChange={e => setVideoDuration(Math.max(2, Math.min(10, parseInt(e.target.value, 10) || 5)))}
                      style={{ width: "100%", boxSizing: "border-box", padding: "6px 10px", fontSize: 12, background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.08)", color: "#f0ebe0", borderRadius: 4, outline: "none", cursor: "pointer" }}
                    >
                      {[2, 3, 4, 5, 6, 7, 8, 9, 10].map(s => (
                        <option key={s} value={String(s)}>{s}s{s === 5 ? " — más barato" : s === 10 ? " — máximo" : ""}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div style={{ fontSize: 10, color: "#7a7668", lineHeight: 1.5 }}>
                  Runway cobra por segundo: Gen-4 Turbo ~$0.05/s y Gen-4.5 ~$0.10/s (máximo 10s por generación — para piezas más largas, generá escenas separadas). Tarda 1-3 min y el mp4 queda guardado en tu biblioteca.
                </div>

                {/* Key status — the editable surface lives in Ajustes de IA */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 10px", borderRadius: 8, background: runwayConfigured ? "rgba(52,211,153,0.05)" : "rgba(251,191,36,0.05)", border: `1px solid ${runwayConfigured ? "rgba(52,211,153,0.22)" : "rgba(251,191,36,0.28)"}` }}>
                  <span style={{ fontSize: 11, color: runwayConfigured ? "#6ee7b7" : "#fbbf24" }}>
                    {runwayConfigured ? "✓ Clave de Runway configurada" : "Falta tu clave de Runway"}
                  </span>
                  <button type="button" onClick={openAiConfigPanel} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 500, border: "1px solid rgba(255,255,255,0.12)", borderRadius: 4, cursor: "pointer", background: "rgba(255,255,255,0.05)", color: "#c8b898", whiteSpace: "nowrap", fontFamily: "inherit", flexShrink: 0 }}>
                    Abrir Ajustes de IA
                  </button>
                </div>

                {/* Live progress: countdown to the median ETA + spaced real
                    checks (the ones that actually decide completion) */}
                {busy && (
                  <div style={{ padding: 12, borderRadius: 8, background: "rgba(236,72,153,0.08)", border: "1px solid rgba(236,72,153,0.3)", textAlign: "center" }}>
                    {videoStatus === "submitting" && (
                      <div style={{ color: "#f9a8d4" }}>{videoMode === "text" ? "🎬 Enviando prompt…" : "🎬 Enviando imagen…"}</div>
                    )}
                    {videoStatus === "processing" && (<>
                      <div style={{ fontSize: 22, fontWeight: 700, color: "#f9a8d4", fontFamily: "SF Mono, monospace" }}>
                        {videoEtaLeft > 0 ? `~${fmt(videoEtaLeft)}` : "⏳"}
                      </div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginTop: 2 }}>
                        {videoEtaLeft > 0 ? "tiempo estimado restante" : "está tardando más de lo usual — sigue trabajando"}
                      </div>
                      <div style={{ fontSize: 10, color: "#7a7668", marginTop: 4 }}>Rechequeo automático en {fmt(Math.max(0, videoNextCheck))}</div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 4 }}>Podés seguir editando mientras.</div>
                    </>)}
                    {videoStatus === "saving" && (
                      <div style={{ color: "#f9a8d4" }}>📥 Guardando el mp4 en tu biblioteca…</div>
                    )}
                  </div>
                )}

                {/* Result: the video plays in the frame next to the image;
                    the mp4 download is cross-origin-safe via Blob */}
                {videoResult && !busy && (
                  <div style={{ padding: "8px 10px", borderRadius: 8, background: "rgba(236,72,153,0.06)", border: "1px solid rgba(236,72,153,0.25)" }}>
                    <div style={{ color: "#f9a8d4", fontWeight: 600, marginBottom: 6 }}>✓ Video listo — junto a la imagen</div>
                    <button
                      type="button"
                      onClick={() => handleDownloadVideo(videoResult.url, videoResult.name)}
                      style={{ width: "100%", padding: "7px 10px", fontSize: 12, fontWeight: 600, border: "1px solid rgba(236,72,153,0.4)", borderRadius: 6, cursor: "pointer", background: "linear-gradient(135deg, rgba(236,72,153,0.2), rgba(168,85,247,0.2))", color: "#f9a8d4", fontFamily: "inherit" }}
                    >
                      ⬇ Descargar mp4
                    </button>
                  </div>
                )}

                {/* Generate */}
                <button
                  type="button"
                  disabled={!ready || busy || !runwayConfigured}
                  onClick={handleGenerateVideo}
                  style={{ padding: "9px 12px", fontSize: 12, fontWeight: 600, border: "1px solid rgba(236,72,153,0.3)", borderRadius: 6, cursor: ready && !busy && runwayConfigured ? "pointer" : "not-allowed", background: ready && !busy && runwayConfigured ? "linear-gradient(135deg, rgba(236,72,153,0.25), rgba(168,85,247,0.25))" : "rgba(255,255,255,0.03)", color: ready && !busy && runwayConfigured ? "#f9a8d4" : "#555", fontFamily: "inherit" }}
                >
                  {busy ? "Generando…" : videoMode === "text" ? "✍️ Generar desde texto" : "🎬 Generar video"}
                </button>
              </div>
            );
          })()}
        </div>
      )}

      {/* ═══ SVG Import Dialog ═══ */}
      {showSvgImport && (
        <SvgImportDialog
          workspaceId={templateWorkspaceId}
          initialFile={routedImportFiles[0] || null}
          onImported={handleSvgImported}
          onRasterImported={handleRasterImageImported}
          onClose={() => { setShowSvgImport(false); setRoutedImportFiles([]); }}
        />
      )}



      {/* ═══ Modo Foto: picker de origen (frames → raster / foto seleccionada) ═══ */}
      {photoFramePickerOpen && (
        <PhotoFramePickerModal
          frames={frames}
          hasSelectedPhoto={!!selectedPhotoLabel}
          selectedPhotoName={selectedPhotoLabel}
          busyFrameId={frameRasterBusyId}
          onPickFrame={handleOpenFrameInPhotoMode}
          onOpenSelectedPhoto={() => { setPhotoFramePickerOpen(false); handleOpenPhotoMode(); }}
          onClose={() => setPhotoFramePickerOpen(false)}
        />
      )}

      {/* ═══ Paste HTML/CSS Modal ═══ */}
      {showPasteHtml && (
        <PasteHtmlModal
          initialFile={routedImportFiles[0] || null}
          onClose={() => { setShowPasteHtml(false); setRoutedImportFiles([]); }}
          onApply={async (result: PasteResult) => {
            await applyPastedHtmlAsFrame(result);
            addToast("✓ HTML/CSS applied", "success");
            setShowPasteHtml(false);
          }}
        />
      )}

      {/* ═══ Export de imprenta: opciones 300dpi + CMYK + soft-proof ═══ */}
      {showPrintDialog && (
        <PrintExportDialog
          frames={exportTargetFrames}
          onClose={() => setShowPrintDialog(false)}
          onRunJob={handleExportFramesPrint}
          onProof={handlePrintProof}
          onSeparations={handlePrintSeparations}
        />
      )}

      {/* Modo Video v2: el overlay ya NO es un take-over fullscreen — vive
          EMBEBIDO en el canvas-area (swap con InfiniteHtmlCanvas) para
          conservar la top bar del editor. Ver el ternario sobre
          {videoModeOpen} dentro de .editor-v2-canvas-area. */}

      {/* ═══ Paste-as-image detection dialog ═══ */}
      {pasteChoiceText !== null && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#111", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: 20, width: 360, color: "#e0e0e0" }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>¿Cómo quieres pegar esto?</div>
            <div style={{ fontSize: 12, color: "#999", marginBottom: 16 }}>
              El contenido copiado parece ser código (HTML/JSON). Puedes pegarlo como un diseño editable o como texto plano.
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <button type="button" onClick={() => handlePasteChoiceConfirm(true)} style={{ flex: 1, padding: "8px 10px", borderRadius: 6, border: "1px solid rgba(200,184,152,0.4)", background: "rgba(200,184,152,0.15)", color: "#e0e0e0", cursor: "pointer", fontSize: 13 }}>Pegar como imagen</button>
              <button type="button" onClick={() => handlePasteChoiceConfirm(false)} style={{ flex: 1, padding: "8px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "#e0e0e0", cursor: "pointer", fontSize: 13 }}>Pegar como texto</button>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#aaa" }}>
              <input type="checkbox" checked={pasteChoiceSnoozeEnabled} onChange={e => setPasteChoiceSnoozeEnabled(e.target.checked)} />
              No preguntar durante
              <input
                type="number"
                min={1}
                max={90}
                value={pasteChoiceSnoozeDays}
                onChange={e => setPasteChoiceSnoozeDays(Math.max(1, Math.min(90, parseInt(e.target.value, 10) || 1)))}
                style={{ width: 48, background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 4, color: "#e0e0e0", padding: "2px 4px" }}
              />
              días
            </label>
          </div>
        </div>
      )}

      {/* ═══ Design Import Modal (SVG, PSD, AI, FIG) ═══ */}
      <DesignImportModal
        open={showDesignImport}
        initialFiles={routedImportFiles.length ? routedImportFiles : null}
        onClose={() => { setShowDesignImport(false); setRoutedImportFiles([]); }}
        onImport={handleDesignImport}
        workspaceId={templateWorkspaceId}
      />

      {/* ═══ Unified Import router — one button, detects the file type ═══ */}
      {showImportRouter && (
        <ImportRouterModal
          onClose={() => setShowImportRouter(false)}
          onRoute={handleImportRoute}
          onDesignFiles={files => { setRoutedImportFiles(files); setShowImportRouter(false); setShowDesignImport(true); }}
        />
      )}

      {/* ═══ Icon Picker — anchored panel, not a modal: click or drag an
          icon onto the canvas while still seeing it live. ═══ */}
      {showIconPicker && (
        <IconPicker
          anchorRect={iconPickerAnchor}
          onClose={() => setShowIconPicker(false)}
          onInsertIcon={handleInsertIconClick}
          onInsertIllustration={handleInsertIllustration}
          onInsertPhoto={handleInsertPhoto}
          onInsertSvg={(svg: string) => {
            const targetFrame = frames.find(f => f.id === selectedFrameId) || frames[0];
            if (!targetFrame) return;
            const layerId = `quiver_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            const wrappedSvg = svg.replace(
              /<svg/,
              `<svg data-layer-id="${layerId}" data-layer-kind="svg" data-layer-name="ai-generated" style="position:absolute;left:50px;top:50px;"`,
            );
            const updatedHtml = (targetFrame.html || "") + wrappedSvg;
            const updatedFrames = frames.map(f =>
              f.id === targetFrame.id ? { ...f, html: updatedHtml } : f,
            );
            store.replaceAllWithUndo(updatedFrames, "edit");
            addToast("✓ SVG generado insertado como capa vectorial.", "success");
          }}
          insertError={iconInsertError}
        />
      )}

      {/* ═══ Gemini API key prompt (convert image → design) ═══
          Shown only when neither the user nor the server has a key. Kept
          visually and textually distinct from the chat's provider key so
          the two never get pasted into the wrong slot. */}
      {showGeminiKeyPrompt && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{
            background: "var(--glass-bg, rgba(20,20,26,0.98))", border: "1px solid var(--glass-border, rgba(255,255,255,0.12))",
            borderRadius: 12, padding: 20, width: 420, maxWidth: "90vw", boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
          }}>
            <h3 style={{ margin: "0 0 8px", fontSize: 15, color: "#f0ebe0" }}>🪄 Convertir imagen a diseño</h3>
            <p style={{ margin: "0 0 12px", fontSize: 12, color: "#9a9484", lineHeight: 1.6 }}>
              Esta función usa <strong style={{ color: "#c8b898" }}>Google Gemini</strong> (visión). Necesita una API key de Gemini,
              que es <strong>distinta</strong> a la del chat — si ahí tienes DeepSeek, esa no sirve aquí.
              Sacala gratis en <span style={{ color: "#c8b898" }}>aistudio.google.com/apikey</span>.
            </p>
            <input
              type="password"
              autoFocus
              value={geminiKeyDraft}
              onChange={e => setGeminiKeyDraft(e.target.value)}
              placeholder="AIza... (Google Gemini API key)"
              style={{
                width: "100%", boxSizing: "border-box", padding: "9px 12px", marginBottom: 12,
                background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 8, color: "#e0e0e0", fontSize: 13, fontFamily: "inherit", outline: "none",
              }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setShowGeminiKeyPrompt(false)}
                style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "#999", fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" }}>
                Cancelar
              </button>
              <button type="button"
                disabled={!geminiKeyDraft.trim() || keySaving}
                onClick={() => {
                  handleSaveGeminiKey(geminiKeyDraft.trim());
                  setShowGeminiKeyPrompt(false);
                }}
                style={{
                  padding: "8px 14px", borderRadius: 8, border: "none",
                  background: geminiKeyDraft.trim() ? "#c8b898" : "rgba(200,184,152,0.25)",
                  color: geminiKeyDraft.trim() ? "#1a1a1a" : "#777",
                  fontSize: 12.5, fontWeight: 600, cursor: geminiKeyDraft.trim() ? "pointer" : "not-allowed", fontFamily: "inherit",
                }}>
                Guardar key
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Quiver Vectorize Preview Panel ═══ */}
      {(vectorizeLoading || vectorizePreview) && (
        <div style={{
          position: "fixed", top: 80, right: 340, zIndex: 800,
          width: 320, maxHeight: "70vh", overflowY: "auto",
          background: "rgba(15,15,20,0.96)", border: "1px solid rgba(139,92,246,0.3)",
          borderRadius: 12, padding: 16, boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          backdropFilter: "blur(12px)",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#a78bfa" }}>✦ Quiver Vectorize</span>
            {vectorizeLoading && <span style={{ fontSize: 11, color: "#7c7c7c" }}>streaming…</span>}
            {!vectorizeLoading && vectorizePreview && (
              <button type="button" onClick={() => { setVectorizePreview(null); setVectorizeReasoning(""); }}
                style={{ fontSize: 11, border: "none", background: "transparent", color: "rgba(255,255,255,0.4)", cursor: "pointer", padding: 0 }}>✕</button>
            )}
          </div>

          {/* Crop mode toggle */}
          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            <button type="button"
              onClick={() => setCropMode("auto")}
              style={{
                flex: 1, padding: "5px 8px", fontSize: 11, borderRadius: 6, border: "none", cursor: "pointer",
                background: cropMode === "auto" ? "rgba(139,92,246,0.2)" : "rgba(255,255,255,0.04)",
                color: cropMode === "auto" ? "#c4b5fd" : "rgba(255,255,255,0.4)",
              }}>Auto-crop</button>
            <button type="button"
              onClick={() => setCropMode("manual")}
              style={{
                flex: 1, padding: "5px 8px", fontSize: 11, borderRadius: 6, border: "none", cursor: "pointer",
                background: cropMode === "manual" ? "rgba(139,92,246,0.2)" : "rgba(255,255,255,0.04)",
                color: cropMode === "manual" ? "#c4b5fd" : "rgba(255,255,255,0.4)",
              }}>Manual</button>
          </div>

          {/* SVG preview */}
          {vectorizePreview ? (
            <div style={{
              background: "rgba(255,255,255,0.97)", borderRadius: 8, padding: 8, marginBottom: 8,
              display: "flex", alignItems: "center", justifyContent: "center", minHeight: 120,
            }}>
              <div style={{ width: "100%", maxWidth: 260 }} dangerouslySetInnerHTML={{ __html: vectorizePreview }} />
            </div>
          ) : (
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              height: 120, color: "rgba(255,255,255,0.3)", fontSize: 12,
            }}>Generando SVG…</div>
          )}

          {/* Reasoning text */}
          {vectorizeReasoning && (
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", lineHeight: 1.5, fontStyle: "italic", marginTop: 8 }}>
              {vectorizeReasoning.substring(0, 200)}{vectorizeReasoning.length > 200 ? "…" : ""}
            </div>
          )}

          {/* Cancel button while loading */}
          {vectorizeLoading && (
            <button type="button" onClick={() => { quiverAbortRef.current?.abort(); setVectorizeLoading(false); }}
              style={{
                width: "100%", marginTop: 8, padding: "6px 12px", fontSize: 12, fontWeight: 500,
                borderRadius: 6, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.1)",
                color: "#f87171", cursor: "pointer", fontFamily: "inherit",
              }}>Cancelar</button>
          )}
        </div>
      )}

      {/* ═══ Save Recipe Toast ═══ */}
      {saveRecipeMsg && (
        <div style={{
          position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)",
          zIndex: 600, padding: "8px 20px", borderRadius: 8,
          background: saveRecipeMsg.startsWith("✓") ? "rgba(34,197,94,0.9)" : "rgba(239,68,68,0.9)",
          color: "#fff", fontSize: 13, fontWeight: 500,
          boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
        }}>
          {saveRecipeMsg}
        </div>
      )}

      {/* ═══ MCP Action Toast ═══ */}
      {mcpMsg && (
        <div style={{
          position: "fixed", bottom: 56, left: "50%", transform: "translateX(-50%)",
          zIndex: 600, padding: "6px 16px", borderRadius: 6,
          background: mcpMsg.startsWith("✓") ? "rgba(34,197,94,0.85)" : "rgba(239,68,68,0.85)",
          color: "#fff", fontSize: 12, fontWeight: 500,
          boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
          backdropFilter: "blur(8px)",
        }}>
          {mcpMsg}
        </div>
      )}


      {/* ═══ Mobile bottom bar: exactly two tools — Mover (one finger pans,
          pinch zooms) and Comentar (single tap opens the composer; without
          it, double-tap does). The desktop floating toolbar is hidden on
          coarse pointers via CSS. ═══ */}
      {isMobile && (
        <div className="editor-v2-mobile-bar">
          <button
            type="button"
            className={`editor-v2-mobile-bar-btn ${!commentMode ? "active" : ""}`}
            onClick={() => setCommentMode(false)}
          >
            <IconHand size={16} />
            <span>Mover</span>
          </button>
          <button
            type="button"
            className={`editor-v2-mobile-bar-btn ${commentMode ? "active" : ""}`}
            onClick={() => setCommentMode(true)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
            <span>Comentar</span>
          </button>
        </div>
      )}

      {/* ═══ Comment composer (double-tap / double-click / comment tool) ═══ */}
      {commentComposer && (
        <div
          className="editor-v2-comment-composer"
          style={{
            left: Math.min(Math.max(commentComposer.screen.x - 130, 8), Math.max(window.innerWidth - 290, 8)),
            top: Math.min(Math.max(commentComposer.screen.y + 16, 8), window.innerHeight - 190),
          }}
        >
          <textarea
            autoFocus
            value={commentDraft}
            onChange={(e) => setCommentDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setCommentComposer(null); setCommentDraft(""); }
            }}
            placeholder="Escribe tu comentario…"
            maxLength={500}
            rows={3}
          />
          <div className="editor-v2-comment-composer-actions">
            <button type="button" className="editor-v2-comment-composer-cancel" onClick={() => { setCommentComposer(null); setCommentDraft(""); }}>Cancelar</button>
            <button type="button" className="editor-v2-comment-composer-save" onClick={handleCommentSave} disabled={commentSaving || !commentDraft.trim()}>
              {commentSaving ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>
      )}


      {/* ═══ Canvas Context Menu (right-click) ═══ */}
      {contextMenu && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 999 }}
            onClick={() => setContextMenu(null)}
          />
          <CanvasContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            selectedElement={selectedElement}
            selectedLayerCount={multiSelectLayerIds.length || selectedOrphanIds.size}
            hasFrameSelection={Boolean(selectedFrameId) || selectedFrameIds.size > 0}
            isHidden={selectedIsHidden}
            isLocked={selectedIsLocked}
            canUndo={canUndo}
            canRedo={canRedo}
            hasClipboard={contextMenu.hasClipboard}
            maskTarget={contextMenu.maskTarget ? {
              pathLayerId: contextMenu.maskTarget.pathLayerId,
              imageLayerId: contextMenu.maskTarget.imageLayerId,
              imageLayerName: contextMenu.maskTarget.imageLayerName,
              mode: contextMenu.maskTarget.mode,
            } : null}
            onCreateSelection={() => contextMenu.maskTarget && handleCreateSelection(contextMenu.maskTarget.frameId, contextMenu.maskTarget.pathLayerId, contextMenu.maskTarget.imageLayerId, "include")}
            onInvertSelection={() => contextMenu.maskTarget && handleInvertSelection(contextMenu.maskTarget.frameId, contextMenu.maskTarget.pathLayerId, contextMenu.maskTarget.imageLayerId, contextMenu.maskTarget.mode)}
            onDeleteExterior={() => contextMenu.maskTarget && handleCreateSelection(contextMenu.maskTarget.frameId, contextMenu.maskTarget.pathLayerId, contextMenu.maskTarget.imageLayerId, "include")}
            onFillSelection={(color) => contextMenu.maskTarget && handleFillSelection(contextMenu.maskTarget.frameId, contextMenu.maskTarget.pathLayerId, contextMenu.maskTarget.imageLayerId, color)}
            onClose={() => setContextMenu(null)}
            onCopy={copySelection}
            onPaste={pasteSelection}
            onPasteAllFrames={handlePasteInAllFrames}
            onStackChange={handleStackChange}
            onGroup={handleGroup}
            onUngroup={handleUngroup}
            onPathfinder={handlePathfinder}
            onUngroupAll={handleUngroupAll}
            onToggleVisibility={handleToggleSelectedVisibility}
            onToggleLock={handleToggleSelectedLock}
            onFlip={handleFlip}
            onCopyCode={() => handleCopyAs("html")}
            onCopyCss={() => handleCopyAs("css")}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onBatchAMator={() => { setShowRightPanel(true); setRightPanelTab("batch"); }}
            onFrameToTemplate={handleSaveRecipe}
            onExtractDesignSystem={handleOpenDesignSystemPanel}
            onInspect={handleInspectElement}
          />
        </>
      )}
    </div>
  );
}
