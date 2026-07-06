import { useRef, useEffect, useCallback, useState } from "react";
import type { HtmlToolName } from "./InfiniteHtmlCanvas";

/**
 * DesignFrame — Renders HTML/CSS inside a Shadow DOM container with
 * a visual interaction overlay (select, drag, resize) and bidirectional
 * code↔DOM sync.
 */

export interface FrameData {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  html: string;
  css: string;
  background: string;
  layoutMode?: "fixed" | "responsive";
  contentHash?: string;
  lastModifiedBy?: string;
  lastModifiedAt?: string;
}

export interface SelectedElementInfo {
  layerId: string;
  tag: string;
  selector: string;
  computedStyles: Record<string, string>;
  frameId: string;
  isSvg: boolean;
  svgChildTag?: string;
}

interface DesignFrameProps {
  frame: FrameData;
  isActive: boolean;
  zoom?: number;
  onActivate: (frameId: string) => void;
  onElementSelect?: (info: SelectedElementInfo | null) => void;
  onCssChange?: (frameId: string, newCss: string, newHtml?: string) => void;
  onHtmlChange?: (frameId: string, newHtml: string) => void;
  activeTool?: HtmlToolName;
  onAddPrimitive?: (type: "rect" | "circle" | "triangle" | "star" | "polygon" | "text", x: number, y: number, sides?: number) => void;
  onDrawShape?: (type: "rect" | "circle" | "triangle" | "star" | "polygon", x: number, y: number, w: number, h: number, sides?: number) => void;
  onTextChange?: (layerId: string, newText: string) => void;
  onAddPenPath?: (pathData: string, bounds: { x: number; y: number; width: number; height: number }, closed?: boolean) => void;
  onEditPathPoints?: (layerId: string, newPathD: string) => void;
  onElementDelete?: (layerId: string) => void;
  onElementDuplicate?: (layerId: string) => void;
}

const SEL = "#3B82F6";
const HANDLE = 7;

const TRACKED_PROPS = [
  // Typography
  "font-family", "font-size", "font-weight", "font-style",
  "text-align", "line-height", "letter-spacing",
  "text-decoration", "text-transform", "white-space", "word-spacing",
  // Color & Background
  "color", "background-color", "background", "background-image",
  "background-size", "background-position", "background-repeat",
  // Spacing
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  // Border
  "border", "border-top", "border-right", "border-bottom", "border-left",
  "border-radius", "border-width", "border-style", "border-color",
  // Dimensions
  "width", "height", "max-width", "max-height", "min-width", "min-height",
  // Position
  "position", "top", "left", "right", "bottom", "z-index",
  // Layout
  "display", "flex-direction", "flex-wrap", "gap", "row-gap", "column-gap",
  "align-items", "justify-content", "align-content", "align-self",
  "flex-grow", "flex-shrink", "flex-basis", "order",
  "grid-template-columns", "grid-template-rows", "grid-gap",
  // Overflow
  "overflow", "overflow-x", "overflow-y",
  // Effects
  "opacity", "box-shadow", "text-shadow",
  "transform", "transform-origin",
  "filter", "backdrop-filter",
  "mix-blend-mode", "background-blend-mode",
  "transition",
];

export function DesignFrame({
  frame, isActive, zoom, onActivate, onElementSelect, onCssChange, onHtmlChange,
  activeTool, onAddPrimitive, onDrawShape, onTextChange, onAddPenPath, onEditPathPoints, onElementDelete, onElementDuplicate,
}: DesignFrameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<ShadowRoot | null>(null);
  const overlayRef = useRef<HTMLElement | null>(null);
  const selectedRef = useRef<Element | null>(null);
  const cssRef = useRef(frame.css);
  const htmlRef = useRef(frame.html);
  // Track the last CSS we wrote to React so we can skip ONLY our own echo.
  // A boolean flag would swallow the next update (e.g. undo) in a batched render.
  // Comparing content ensures we only skip when React feeds back the exact CSS
  // we just emitted via onCssChange.
  const lastEmittedCssRef = useRef<string | null>(null);
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;
  const onAddPrimitiveRef = useRef(onAddPrimitive);
  onAddPrimitiveRef.current = onAddPrimitive;
  const onDrawShapeRef = useRef(onDrawShape);
  onDrawShapeRef.current = onDrawShape;
  const onTextChangeRef = useRef(onTextChange);
  onTextChangeRef.current = onTextChange;
  const onAddPenPathRef = useRef(onAddPenPath);
  onAddPenPathRef.current = onAddPenPath;
  const onElementDeleteRef = useRef(onElementDelete);
  onElementDeleteRef.current = onElementDelete;
  const onElementDuplicateRef = useRef(onElementDuplicate);
  onElementDuplicateRef.current = onElementDuplicate;
  const onEditPathPointsRef = useRef(onEditPathPoints);
  onEditPathPointsRef.current = onEditPathPoints;
  const onCssChangeRef = useRef(onCssChange);
  onCssChangeRef.current = onCssChange;
  const onHtmlChangeRef = useRef(onHtmlChange);
  onHtmlChangeRef.current = onHtmlChange;
  const editingTextRef = useRef<Element | null>(null);
  const zoomRef = useRef(zoom || 1);
  zoomRef.current = zoom || 1;

  // ── Shadow DOM init (once) ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el || shadowRef.current) return;
    const shadow = el.attachShadow({ mode: "open" });
    shadowRef.current = shadow;

    // Google Fonts extraction: find @import url(...) in CSS
    const fontLinks = extractFontImports(frame.css);

    // Inject font links
    for (const href of fontLinks) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      shadow.appendChild(link);
    }

    // Style element
    const style = document.createElement("style");
    style.textContent = frame.css;
    shadow.appendChild(style);

    // Content container
    const content = document.createElement("div");
    content.id = "__df_content";
    content.innerHTML = frame.html;
    shadow.appendChild(content);

    // Overlay layer
    const overlay = document.createElement("div");
    overlay.id = "__df_overlay";
    Object.assign(overlay.style, {
      position: "absolute", top: "0", left: "0",
      width: "100%", height: "100%",
      pointerEvents: "none", zIndex: "9999",
    });
    shadow.appendChild(overlay);
    overlayRef.current = overlay;

    // Attach interaction handlers
    setupInteraction(shadow, content, overlay);

    // ═══ DIAGNOSTIC: Shadow init state ═══
    requestAnimationFrame(() => {
      const contentRect = content.getBoundingClientRect();
      const overlayPE = overlay.style.pointerEvents;
      const overlayComputedPE = getComputedStyle(overlay).pointerEvents;

      // Scan all content children for pointer-events issues
      const allEls = content.querySelectorAll("*");
      const peIssues: { tag: string; selector: string; computedPE: string }[] = [];
      allEls.forEach((child) => {
        const cpe = getComputedStyle(child).pointerEvents;
        if (cpe === "none") {
          peIssues.push({
            tag: child.tagName,
            selector: getSelector(child as HTMLElement),
            computedPE: cpe,
          });
        }
      });

      console.error("[SHADOW-INIT]", {
        frameId: frame.id,
        hasShadow: !!shadowRef.current,
        hostW: el.offsetWidth,
        hostH: el.offsetHeight,
        contentW: contentRect.width,
        contentH: contentRect.height,
        contentChildren: content.children.length,
        cssHasPointerEvents: /pointer-events\s*:/i.test(frame.css),
        overlayStylePE: overlayPE,
        overlayComputedPE,
        peDisabledCount: peIssues.length,
        peIssues: peIssues.slice(0, 20),
      });
    });

    // ═══ DIAGNOSTIC: Capture-phase host listener ═══
    // Fires BEFORE the shadow tree listener — tells us if events reach the host at all
    el.addEventListener("mousedown", (ev: MouseEvent) => {
      const path = ev.composedPath();
      const inShadow = path.includes(content);
      console.error("[HOST-MDOWN]", {
        frameId: frame.id,
        button: ev.button,
        target: (ev.target as Element)?.tagName,
        targetInShadow: inShadow,
        composedPath: path.slice(0, 10).map((p: any) =>
          p.tagName || (p === shadow ? "#shadow-root" : p.nodeName?.toLowerCase?.() || "unknown"),
        ),
      });
    }, true); // capture = true
  }, []);

  // ── Code → DOM: CSS update ──
  useEffect(() => {
    // Skip only if React is feeding back the exact CSS we just emitted (echo suppression).
    // This allows undo/redo updates (different CSS) to flow through unblocked.
    if (lastEmittedCssRef.current === frame.css) {
      lastEmittedCssRef.current = null; // consume the echo
      return;
    }
    cssRef.current = frame.css;
    const shadow = shadowRef.current;
    if (!shadow) return;
    const style = shadow.querySelector("style");
    if (style) { style.textContent = frame.css; console.warn("[SHADOW CSS] POST set textContent", { styleLen: style.textContent.length, hasMontserrat: style.textContent.includes("Montserrat"), linkCount: shadow.querySelectorAll("link").length }); }
    // Update font imports
    const existingLinks = shadow.querySelectorAll("link");
    const newHrefs = extractFontImports(frame.css);
    existingLinks.forEach(l => { if (!newHrefs.includes((l as HTMLLinkElement).href)) l.remove(); });
    for (const href of newHrefs) {
      if (![...shadow.querySelectorAll("link")].some(l => (l as HTMLLinkElement).href === href)) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        shadow.insertBefore(link, shadow.firstChild);
      }
    }
    if (selectedRef.current) refreshOverlay(selectedRef.current);
  }, [frame.css]);

  // ── Code → DOM: HTML update ──
  useEffect(() => {
    htmlRef.current = frame.html;
    const shadow = shadowRef.current;
    if (!shadow) return;
    const content = shadow.getElementById("__df_content");
    if (content) content.innerHTML = frame.html;
    selectedRef.current = null;
    clearOverlay();
    // Clear pen state on HTML update
    penPointsRef.current = [];
    penSvgRef.current = null;
  }, [frame.html]);

  function clearOverlay() {
    if (overlayRef.current) overlayRef.current.innerHTML = "";
    pointEditPathRef.current = null;
    pointEditOverlayRef.current = null;
  }

  function refreshOverlay(el: Element) {
    const overlay = overlayRef.current;
    const shadow = shadowRef.current;
    if (!overlay || !shadow) return;
    overlay.innerHTML = "";
    pointEditPathRef.current = null;
    pointEditOverlayRef.current = null;

    const content = shadow.getElementById("__df_content")!;
    const elRect = el.getBoundingClientRect();
    const cRect = content.getBoundingClientRect();
    const z = zoomRef.current || 1;
    const x = (elRect.left - cRect.left) / z;
    const y = (elRect.top - cRect.top) / z;
    const w = elRect.width / z;
    const h = elRect.height / z;

    // Check if selected element is an SVG path (for point editing)
    const elTag = el.tagName.toLowerCase();
    const isPathEl = elTag === "path";
    const pathEl = isPathEl ? el : (el as Element).querySelector?.("path");
    const hasPath = isPathEl || !!pathEl;
    const targetPath = (isPathEl ? el : pathEl) as Element | null;
    const pathData = targetPath?.getAttribute("d");

    // Selection border (always show)
    const box = document.createElement("div");
    Object.assign(box.style, {
      position: "absolute",
      left: `${x}px`, top: `${y}px`,
      width: `${w}px`, height: `${h}px`,
      border: `2px solid ${SEL}`,
      pointerEvents: "none",
      boxSizing: "border-box",
    });
    overlay.appendChild(box);

    // If this is an SVG path, render point editing overlay
    if (hasPath && pathData && targetPath) {
      const cmds = parsePathCommands(pathData);
      const layerId = el.getAttribute("data-layer-id") || targetPath.getAttribute("data-layer-id");
      pointEditPathRef.current = { layerId: layerId || "", commands: cmds };

      // Create point edit SVG overlay
      const editSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      editSvg.setAttribute("width", "100%");
      editSvg.setAttribute("height", "100%");
      Object.assign(editSvg.style, {
        position: "absolute", top: "0", left: "0",
        width: "100%", height: "100%",
        pointerEvents: "none", zIndex: "10000",
        overflow: "visible",
      });
      overlay.appendChild(editSvg);
      pointEditOverlayRef.current = editSvg;

      // Get SVG element's viewBox offset
      const svgEl = targetPath.closest("svg");
      const svgRect = svgEl?.getBoundingClientRect();
      const svgVbStr = svgEl?.getAttribute("viewBox");
      let vbX = 0, vbY = 0;
      if (svgVbStr) {
        const vbp = svgVbStr.split(/\s+/);
        vbX = parseFloat(vbp[0]) || 0;
        vbY = parseFloat(vbp[1]) || 0;
      }
      // Offset from content rect to SVG rect
      const svgLeft = svgRect ? (svgRect.left - cRect.left) / z : x;
      const svgTop = svgRect ? (svgRect.top - cRect.top) / z : y;

      // Render anchor points and control handles
      for (let ci = 0; ci < cmds.length; ci++) {
        const cmd = cmds[ci];
        if (cmd.type === "Z") continue;

        const px = cmd.x + svgLeft - vbX;
        const py = cmd.y + svgTop - vbY;

        // Anchor point
        const anchor = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        anchor.setAttribute("cx", `${px}`);
        anchor.setAttribute("cy", `${py}`);
        anchor.setAttribute("r", cmd.type === "C" ? "5" : "4");
        anchor.setAttribute("fill", cmd.type === "M" ? "#10B981" : cmd.type === "C" ? "#A78BFA" : "#3B82F6");
        anchor.setAttribute("stroke", "#fff");
        anchor.setAttribute("stroke-width", "1.5");
        anchor.style.cursor = "move";
        anchor.style.pointerEvents = "auto";
        anchor.setAttribute("data-pe-cmd", `${ci}`);
        anchor.setAttribute("data-pe-ctrl", "anchor");
        editSvg.appendChild(anchor);

        // Control handles for bezier
        if (cmd.type === "C") {
          // Handle 1 (incoming)
          const h1x = cmd.cx1 + svgLeft - vbX;
          const h1y = cmd.cy1 + svgTop - vbY;
          const line1 = document.createElementNS("http://www.w3.org/2000/svg", "line");
          line1.setAttribute("x1", `${px}`); line1.setAttribute("y1", `${py}`);
          line1.setAttribute("x2", `${h1x}`); line1.setAttribute("y2", `${h1y}`);
          line1.setAttribute("stroke", "#A78BFA"); line1.setAttribute("stroke-width", "1");
          line1.setAttribute("opacity", "0.5"); line1.style.pointerEvents = "none";
          editSvg.appendChild(line1);

          const c1 = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          c1.setAttribute("cx", `${h1x}`); c1.setAttribute("cy", `${h1y}`);
          c1.setAttribute("r", "3"); c1.setAttribute("fill", "#F59E0B");
          c1.setAttribute("stroke", "#fff"); c1.setAttribute("stroke-width", "1");
          c1.style.cursor = "move"; c1.style.pointerEvents = "auto";
          c1.setAttribute("data-pe-cmd", `${ci}`);
          c1.setAttribute("data-pe-ctrl", "cp1");
          editSvg.appendChild(c1);

          // Handle 2 (outgoing)
          const h2x = cmd.cx2 + svgLeft - vbX;
          const h2y = cmd.cy2 + svgTop - vbY;
          const line2 = document.createElementNS("http://www.w3.org/2000/svg", "line");
          line2.setAttribute("x1", `${px}`); line2.setAttribute("y1", `${py}`);
          line2.setAttribute("x2", `${h2x}`); line2.setAttribute("y2", `${h2y}`);
          line2.setAttribute("stroke", "#8B5CF6"); line2.setAttribute("stroke-width", "1");
          line2.setAttribute("opacity", "0.5"); line2.style.pointerEvents = "none";
          editSvg.appendChild(line2);

          const c2 = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          c2.setAttribute("cx", `${h2x}`); c2.setAttribute("cy", `${h2y}`);
          c2.setAttribute("r", "3"); c2.setAttribute("fill", "#8B5CF6");
          c2.setAttribute("stroke", "#fff"); c2.setAttribute("stroke-width", "1");
          c2.style.cursor = "move"; c2.style.pointerEvents = "auto";
          c2.setAttribute("data-pe-cmd", `${ci}`);
          c2.setAttribute("data-pe-ctrl", "cp2");
          editSvg.appendChild(c2);
        }
      }

      // Attach point editing mouse handlers
      editSvg.addEventListener("mousedown", (e: Event) => {
        const me = e as MouseEvent;
        const target = me.target as SVGElement;
        const cmdIdx = target.getAttribute("data-pe-cmd");
        const ctrl = target.getAttribute("data-pe-ctrl");
        if (cmdIdx == null) return;
        e.stopPropagation();
        e.preventDefault();
        const ci = parseInt(cmdIdx);
        const editData = pointEditPathRef.current;
        if (!editData) return;

        const svgEl2 = targetPath.closest("svg");
        const svgRect2 = svgEl2?.getBoundingClientRect();
        const cRect2 = content.getBoundingClientRect();
        const svgLeft2 = svgRect2 ? (svgRect2.left - cRect2.left) / z : x;
        const svgTop2 = svgRect2 ? (svgRect2.top - cRect2.top) / z : y;
        const svgVbStr2 = svgEl2?.getAttribute("viewBox");
        let vbX2 = 0, vbY2 = 0;
        if (svgVbStr2) {
          const vbp = svgVbStr2.split(/\s+/);
          vbX2 = parseFloat(vbp[0]) || 0;
          vbY2 = parseFloat(vbp[1]) || 0;
        }

        const onPeMove = (ev: MouseEvent) => {
          const cx = (ev.clientX - cRect.left) / z - svgLeft2 + vbX2;
          const cy = (ev.clientY - cRect.top) / z - svgTop2 + vbY2;
          const cmd = editData.commands[ci];
          if (!cmd) return;

          if (ctrl === "anchor") {
            const dx = cx - cmd.x;
            const dy = cy - cmd.y;
            cmd.x = Math.round(cx);
            cmd.y = Math.round(cy);
            if (cmd.type === "C") {
              cmd.cx1 = Math.round(cmd.cx1 + dx);
              cmd.cy1 = Math.round(cmd.cy1 + dy);
              cmd.cx2 = Math.round(cmd.cx2 + dx);
              cmd.cy2 = Math.round(cmd.cy2 + dy);
            }
          } else if (ctrl === "cp1" && cmd.type === "C") {
            cmd.cx1 = Math.round(cx);
            cmd.cy1 = Math.round(cy);
            // If not Alt, mirror cp2
            if (!(ev.altKey || (ev as any).altKey)) {
              cmd.cx2 = Math.round(cmd.x + (cmd.x - cx));
              cmd.cy2 = Math.round(cmd.y + (cmd.y - cy));
            }
          } else if (ctrl === "cp2" && cmd.type === "C") {
            cmd.cx2 = Math.round(cx);
            cmd.cy2 = Math.round(cy);
            if (!(ev.altKey || (ev as any).altKey)) {
              cmd.cx1 = Math.round(cmd.x + (cmd.x - cx));
              cmd.cy1 = Math.round(cmd.y + (cmd.y - cy));
            }
          }

          // Update the path element's d attribute live
          const newD = buildPathFromCommands(editData.commands);
          targetPath.setAttribute("d", newD);

          // Refresh overlay to show updated handles
          refreshOverlay(el);
        };

        const onPeUp = () => {
          document.removeEventListener("mousemove", onPeMove);
          document.removeEventListener("mouseup", onPeUp);
          // Persist the path data change
          const newD = buildPathFromCommands(editData.commands);
          const lid = editData.layerId;
          if (lid && onEditPathPointsRef.current) {
            onEditPathPointsRef.current(lid, newD);
          }
        };

        document.addEventListener("mousemove", onPeMove);
        document.addEventListener("mouseup", onPeUp);
      });
    } else {
      // Rotation handle (above selection box)
      const rotHandleY = y - 24;
      // Dashed line from top-center to rotation handle
      const rotLine = document.createElement("div");
      Object.assign(rotLine.style, {
        position: "absolute",
        left: `${x + w / 2 - 0.5}px`,
        top: `${rotHandleY + 8}px`,
        width: "1px", height: `${y - rotHandleY - 8}px`,
        borderLeft: "1px dashed rgba(59,130,246,0.4)",
        pointerEvents: "none",
      });
      overlay.appendChild(rotLine);

      const rotHandle = document.createElement("div");
      Object.assign(rotHandle.style, {
        position: "absolute",
        left: `${x + w / 2 - 7}px`,
        top: `${rotHandleY}px`,
        width: "14px", height: "14px",
        borderRadius: "50%",
        border: "2px solid #3B82F6",
        background: "rgba(59,130,246,0.15)",
        cursor: "grab",
        pointerEvents: "auto",
        boxSizing: "border-box",
      });
      overlay.appendChild(rotHandle);

      rotHandle.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        e.preventDefault();
        const centerX = x + w / 2;
        const centerY = y + h / 2;
        const startAngle = Math.atan2(
          (e as MouseEvent).clientY - cRect.top - centerY * z,
          (e as MouseEvent).clientX - cRect.left - centerX * z
        );
        let currentRotation = 0;
        const existingTransform = (el as HTMLElement).style.transform || "";
        const rotMatch = existingTransform.match(/rotate\(([^)]+)deg\)/);
        const baseRotation = rotMatch ? parseFloat(rotMatch[1]) : 0;

        const onRotMove = (ev: MouseEvent) => {
          const angle = Math.atan2(
            ev.clientY - cRect.top - centerY * z,
            ev.clientX - cRect.left - centerX * z
          );
          currentRotation = baseRotation + (angle - startAngle) * (180 / Math.PI);
          (el as HTMLElement).style.transform = `rotate(${Math.round(currentRotation)}deg)`;
        };

        const onRotUp = () => {
          document.removeEventListener("mousemove", onRotMove);
          document.removeEventListener("mouseup", onRotUp);
          const sel = getSelector(el);
          if (Math.abs(currentRotation) < 0.5) {
            // Remove rotation if near zero
            (el as HTMLElement).style.transform = "";
            const updated = updateCssRule(cssRef.current, sel, { transform: "none" });
            cssRef.current = updated;
            lastEmittedCssRef.current = updated;
            onCssChangeRef.current?.(frame.id, updated, content.innerHTML);
          } else {
            const updated = updateCssRule(cssRef.current, sel, { transform: `rotate(${Math.round(currentRotation)}deg)` });
            cssRef.current = updated;
            lastEmittedCssRef.current = updated;
            onCssChangeRef.current?.(frame.id, updated, content.innerHTML);
          }
        };

        document.addEventListener("mousemove", onRotMove);
        document.addEventListener("mouseup", onRotUp);
      });

      // Standard resize handles (only for non-path elements)
      const handles: [number, number, string][] = [
        [0, 0, "nwse-resize"], [0.5, 0, "ns-resize"], [1, 0, "nesw-resize"],
        [0, 0.5, "ew-resize"], [1, 0.5, "ew-resize"],
        [0, 1, "nesw-resize"], [0.5, 1, "ns-resize"], [1, 1, "nwse-resize"],
      ];
      for (const [cx, cy, cursor] of handles) {
        const handle = document.createElement("div");
        Object.assign(handle.style, {
          position: "absolute",
          left: `${x + cx * w - HANDLE / 2}px`,
          top: `${y + cy * h - HANDLE / 2}px`,
          width: `${HANDLE}px`, height: `${HANDLE}px`,
          background: SEL, border: "1px solid #fff",
          cursor, pointerEvents: "auto", boxSizing: "border-box",
        });
        overlay.appendChild(handle);
        handle.addEventListener("mousedown", (e) => {
          e.stopPropagation();
          e.preventDefault();
          startResize(el, e as MouseEvent, cursor, x, y, w, h);
        });
      }
    }
  }

  const penPointsRef = useRef<(any)[]>([]);
  const penSvgRef = useRef<SVGElement | null>(null);
  // Bezier pen drag state
  const penDragStartRef = useRef<{x: number; y: number} | null>(null);
  const penDragActiveRef = useRef(false);
  const penDragPreviewRef = useRef<SVGElement | null>(null);
  // Point editing state
  const pointEditPathRef = useRef<{ layerId: string; commands: any[] } | null>(null);
  const pointEditOverlayRef = useRef<SVGElement | null>(null);
  const pointEditDragRef = useRef<{ cmdIndex: number; isControl: boolean; controlIndex: number } | null>(null);

  // ── Pen preview renderer (supports bezier curves) ──
  function drawPenPreview(content: HTMLElement, pts: any[], dragAnchor?: {x:number;y:number}, dragControl?: {x:number;y:number}, alt?: boolean) {
    // Ensure SVG container
    if (!penSvgRef.current) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      Object.assign(svg.style, {
        position: "absolute", top: "0", left: "0",
        width: "100%", height: "100%",
        pointerEvents: "none", zIndex: "9998",
        overflow: "visible",
      });
      svg.setAttribute("width", "100%");
      svg.setAttribute("height", "100%");
      content.appendChild(svg);
      penSvgRef.current = svg;
    }
    const svg = penSvgRef.current;
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    // Build path data from points (including bezier info)
    if (pts.length >= 1) {
      let pathD = `M ${pts[0].x} ${pts[0].y}`;
      for (let i = 1; i < pts.length; i++) {
        const prev = pts[i - 1];
        const curr = pts[i];
        if (curr.cx1 !== undefined || curr.cx2 !== undefined) {
          // Bezier curve: use C command
          const cx1 = curr.cx1 ?? prev.x;
          const cy1 = curr.cy1 ?? prev.y;
          const cx2 = curr.cx2 ?? curr.x;
          const cy2 = curr.cy2 ?? curr.y;
          pathD += ` C ${cx1} ${cy1}, ${cx2} ${cy2}, ${curr.x} ${curr.y}`;
        } else {
          pathD += ` L ${curr.x} ${curr.y}`;
        }
      }

      // Add preview segment for active drag
      if (dragAnchor && dragControl) {
        const lastPt = pts[pts.length - 1];
        if (alt) {
          pathD += ` C ${dragAnchor.x} ${dragAnchor.y}, ${dragControl.x} ${dragControl.y}, ${dragAnchor.x} ${dragAnchor.y}`;
        } else {
          // Symmetric: mirror on both sides
          const mdx = dragAnchor.x - (dragControl.x - dragAnchor.x) * 0.5;
          const mdy = dragAnchor.y - (dragControl.y - dragAnchor.y) * 0.5;
          const cpx = dragAnchor.x + (dragControl.x - dragAnchor.x) * 0.5;
          const cpy = dragAnchor.y + (dragControl.y - dragAnchor.y) * 0.5;
          pathD += ` C ${mdx} ${mdy}, ${cpx} ${cpy}, ${dragAnchor.x} ${dragAnchor.y}`;
        }
      }

      const pathEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
      pathEl.setAttribute("d", pathD);
      pathEl.setAttribute("fill", "none");
      pathEl.setAttribute("stroke", "#8B5CF6");
      pathEl.setAttribute("stroke-width", "2");
      pathEl.setAttribute("stroke-dasharray", "6,3");
      pathEl.setAttribute("stroke-linecap", "round");
      svg.appendChild(pathEl);
    }

    // Draw anchor points
    for (const p of pts) {
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", `${p.x}`);
      circle.setAttribute("cy", `${p.y}`);
      circle.setAttribute("r", p.cx1 !== undefined ? "5" : "4");
      circle.setAttribute("fill", p.cx1 !== undefined ? "#A78BFA" : "#8B5CF6");
      circle.setAttribute("stroke", "#fff");
      circle.setAttribute("stroke-width", "1.5");
      svg.appendChild(circle);

      // Draw control handles for bezier points
      if (p.cx1 !== undefined && p.cy1 !== undefined) {
        const line1 = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line1.setAttribute("x1", `${p.x}`);
        line1.setAttribute("y1", `${p.y}`);
        line1.setAttribute("x2", `${p.cx1}`);
        line1.setAttribute("y2", `${p.cy1}`);
        line1.setAttribute("stroke", "#A78BFA");
        line1.setAttribute("stroke-width", "1");
        line1.setAttribute("opacity", "0.5");
        svg.appendChild(line1);

        const c1 = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        c1.setAttribute("cx", `${p.cx1}`); c1.setAttribute("cy", `${p.cy1}`);
        c1.setAttribute("r", "3"); c1.setAttribute("fill", "#F59E0B");
        c1.setAttribute("stroke", "#fff"); c1.setAttribute("stroke-width", "1");
        svg.appendChild(c1);
      }
      if (p.cx2 !== undefined && p.cy2 !== undefined) {
        const line2 = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line2.setAttribute("x1", `${p.x}`);
        line2.setAttribute("y1", `${p.y}`);
        line2.setAttribute("x2", `${p.cx2}`);
        line2.setAttribute("y2", `${p.cy2}`);
        line2.setAttribute("stroke", "#8B5CF6");
        line2.setAttribute("stroke-width", "1");
        line2.setAttribute("opacity", "0.5");
        svg.appendChild(line2);

        const c2 = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        c2.setAttribute("cx", `${p.cx2}`); c2.setAttribute("cy", `${p.cy2}`);
        c2.setAttribute("r", "3"); c2.setAttribute("fill", "#8B5CF6");
        c2.setAttribute("stroke", "#fff"); c2.setAttribute("stroke-width", "1");
        svg.appendChild(c2);
      }
    }

    // Draw drag preview anchor + control lines
    if (dragAnchor && dragControl) {
      // Anchor dot
      const a = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      a.setAttribute("cx", `${dragAnchor.x}`); a.setAttribute("cy", `${dragAnchor.y}`);
      a.setAttribute("r", "5"); a.setAttribute("fill", "#A78BFA");
      a.setAttribute("stroke", "#fff"); a.setAttribute("stroke-width", "1.5");
      svg.appendChild(a);

      // Handle lines
      if (alt) {
        const hl = document.createElementNS("http://www.w3.org/2000/svg", "line");
        hl.setAttribute("x1", `${dragAnchor.x}`); hl.setAttribute("y1", `${dragAnchor.y}`);
        hl.setAttribute("x2", `${dragControl.x}`); hl.setAttribute("y2", `${dragControl.y}`);
        hl.setAttribute("stroke", "#8B5CF6"); hl.setAttribute("stroke-width", "1");
        hl.setAttribute("opacity", "0.5");
        svg.appendChild(hl);
      } else {
        const mdx = dragAnchor.x - (dragControl.x - dragAnchor.x) * 0.5;
        const mdy = dragAnchor.y - (dragControl.y - dragAnchor.y) * 0.5;
        const hl1 = document.createElementNS("http://www.w3.org/2000/svg", "line");
        hl1.setAttribute("x1", `${dragAnchor.x}`); hl1.setAttribute("y1", `${dragAnchor.y}`);
        hl1.setAttribute("x2", `${mdx}`); hl1.setAttribute("y2", `${mdy}`);
        hl1.setAttribute("stroke", "#A78BFA"); hl1.setAttribute("stroke-width", "1");
        hl1.setAttribute("opacity", "0.5");
        svg.appendChild(hl1);
      }
      const hl2 = document.createElementNS("http://www.w3.org/2000/svg", "line");
      hl2.setAttribute("x1", `${dragAnchor.x}`); hl2.setAttribute("y1", `${dragAnchor.y}`);
      hl2.setAttribute("x2", `${dragControl.x}`); hl2.setAttribute("y2", `${dragControl.y}`);
      hl2.setAttribute("stroke", "#8B5CF6"); hl2.setAttribute("stroke-width", "1");
      hl2.setAttribute("opacity", "0.5");
      svg.appendChild(hl2);

      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("cx", `${dragControl.x}`); c.setAttribute("cy", `${dragControl.y}`);
      c.setAttribute("r", "3"); c.setAttribute("fill", "#F59E0B");
      c.setAttribute("stroke", "#fff"); c.setAttribute("stroke-width", "1");
      svg.appendChild(c);
    }
  }

  // ── Path parsing helpers for point editing ──
  function parsePathCommands(pathData: string): any[] {
    const tokens = pathData.match(/[a-zA-Z]|[-+]?\d*\.?\d+/g) || [];
    const cmds: any[] = [];
    let i = 0;
    while (i < tokens.length) {
      const c = tokens[i];
      if (c === "M" || c === "m") {
        cmds.push({ type: "M", x: parseFloat(tokens[i+1]) || 0, y: parseFloat(tokens[i+2]) || 0 });
        i += 3;
      } else if (c === "L" || c === "l") {
        cmds.push({ type: "L", x: parseFloat(tokens[i+1]) || 0, y: parseFloat(tokens[i+2]) || 0 });
        i += 3;
      } else if (c === "C" || c === "c") {
        cmds.push({ type: "C", cx1: parseFloat(tokens[i+1]) || 0, cy1: parseFloat(tokens[i+2]) || 0, cx2: parseFloat(tokens[i+3]) || 0, cy2: parseFloat(tokens[i+4]) || 0, x: parseFloat(tokens[i+5]) || 0, y: parseFloat(tokens[i+6]) || 0 });
        i += 7;
      } else if (c === "Z" || c === "z") {
        cmds.push({ type: "Z" });
        i++;
      } else if (c === "H" || c === "h") {
        cmds.push({ type: "H", x: parseFloat(tokens[i+1]) || 0 });
        i += 2;
      } else if (c === "V" || c === "v") {
        cmds.push({ type: "V", y: parseFloat(tokens[i+1]) || 0 });
        i += 2;
      } else { i++; }
    }
    return cmds;
  }

  function buildPathFromCommands(cmds: any[]): string {
    const parts: string[] = [];
    for (const cmd of cmds) {
      if (cmd.type === "M") parts.push(`M ${cmd.x} ${cmd.y}`);
      else if (cmd.type === "L") parts.push(`L ${cmd.x} ${cmd.y}`);
      else if (cmd.type === "C") parts.push(`C ${cmd.cx1} ${cmd.cy1}, ${cmd.cx2} ${cmd.cy2}, ${cmd.x} ${cmd.y}`);
      else if (cmd.type === "Z") parts.push("Z");
      else if (cmd.type === "H") parts.push(`H ${cmd.x}`);
      else if (cmd.type === "V") parts.push(`V ${cmd.y}`);
    }
    return parts.join(" ");
  }

  function setupInteraction(shadow: ShadowRoot, content: HTMLElement, overlay: HTMLElement) {
    const DRAG_THRESHOLD = 4;

    // ── Unified mousedown handler ──
    content.addEventListener("mousedown", (e: Event) => {
      const me = e as MouseEvent;
      if (me.button !== 0) return;
      const target = me.target as HTMLElement;
      console.error("[DRAG] mousedown on content", { frameId: frame.id, target: target.tagName, tool: activeToolRef.current });
      const tool = activeToolRef.current;
      const rect = content.getBoundingClientRect();
      const z = zoomRef.current || 1;
      const mx = (me.clientX - rect.left) / z;
      const my = (me.clientY - rect.top) / z;

      // ── Drawing tools: rect / circle / triangle / star / polygon → drag-to-draw ──
      if (tool === "rect" || tool === "circle" || tool === "triangle" || tool === "star" || tool === "polygon") {
        e.stopPropagation();
        e.preventDefault();
        onActivate(frame.id);

        const startX = mx;
        const startY = my;
        let drawing = false;

        // Create preview element
        const preview = document.createElement("div");
        Object.assign(preview.style, {
          position: "absolute",
          left: `${startX}px`, top: `${startY}px`,
          width: "0px", height: "0px",
          border: `2px dashed ${tool === "rect" ? "#3B82F6" : "#EF4444"}`,
          background: tool === "rect" ? "rgba(59,130,246,0.1)" : "rgba(239,68,68,0.1)",
          borderRadius: tool === "circle" ? "50%" : "4px",
          pointerEvents: "none",
          boxSizing: "border-box",
          zIndex: "9998",
        });
        content.appendChild(preview);

        const onMove = (ev: MouseEvent) => {
          drawing = true;
          const cx = (ev.clientX - rect.left) / z;
          const cy = (ev.clientY - rect.top) / z;
          let w = cx - startX;
          let h = cy - startY;

          // Shift constrains to square/circle
          if (ev.shiftKey) {
            const size = Math.max(Math.abs(w), Math.abs(h));
            w = w < 0 ? -size : size;
            h = h < 0 ? -size : size;
          }

          const x = w < 0 ? startX + w : startX;
          const y = h < 0 ? startY + h : startY;
          const absW = Math.abs(w);
          const absH = Math.abs(h);

          preview.style.left = `${x}px`;
          preview.style.top = `${y}px`;
          preview.style.width = `${absW}px`;
          preview.style.height = `${absH}px`;
        };

        const onUp = (ev: MouseEvent) => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          preview.remove();

          if (!drawing) {
            // Short click → place default-sized primitive
            onAddPrimitiveRef.current?.(tool, Math.round(startX), Math.round(startY));
            return;
          }

          const cx = (ev.clientX - rect.left) / z;
          const cy = (ev.clientY - rect.top) / z;
          let w = cx - startX;
          let h = cy - startY;
          if (ev.shiftKey) {
            const size = Math.max(Math.abs(w), Math.abs(h));
            w = w < 0 ? -size : size;
            h = h < 0 ? -size : size;
          }
          const finalX = Math.round(w < 0 ? startX + w : startX);
          const finalY = Math.round(h < 0 ? startY + h : startY);
          const finalW = Math.max(10, Math.round(Math.abs(w)));
          const finalH = Math.max(10, Math.round(Math.abs(h)));

          const sides = (tool === "polygon" && ev.shiftKey) ? prompt("Number of sides?", "6") : undefined;
          const sidesNum = sides ? parseInt(sides) || 6 : undefined;
          onDrawShapeRef.current?.(tool, finalX, finalY, finalW, finalH, sidesNum);
        };

        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        return;
      }

      // ── Pen tool: click to add points, drag for bezier handles ──
      if (tool === "pen") {
        e.stopPropagation();
        e.preventDefault();
        onActivate(frame.id);

        const point = { x: Math.round(mx), y: Math.round(my) };
        const pts = penPointsRef.current;

        // E0: Check if clicking near first point to close path
        if (pts.length >= 2) {
          const firstPt = pts[0];
          const dist = Math.hypot(point.x - firstPt.x, point.y - firstPt.y);
          if (dist < 12) {
            finalizePenPath(content, true);
            return;
          }
        }

        // Start bezier drag tracking
        penDragStartRef.current = { x: point.x, y: point.y };
        penDragActiveRef.current = false;
        let dragged = false;

        const onPenMove = (ev: MouseEvent) => {
          const cx = (ev.clientX - rect.left) / z;
          const cy = (ev.clientY - rect.top) / z;
          const dx = cx - point.x;
          const dy = cy - point.y;
          const dist = Math.hypot(dx, dy);

          if (dist >= DRAG_THRESHOLD) {
            dragged = true;
            penDragActiveRef.current = true;
            // Update preview showing bezier handles
            drawPenPreview(content, pts, point, { x: Math.round(cx), y: Math.round(cy) }, ev.altKey || (ev as any).altKey);
          }
        };

        const onPenUp = (ev: MouseEvent) => {
          document.removeEventListener("mousemove", onPenMove);
          document.removeEventListener("mouseup", onPenUp);

          if (!dragged) {
            // Click: add straight line point
            pts.push(point);
            drawPenPreview(content, pts);
          } else {
            // Drag: add bezier point
            const cx = (ev.clientX - rect.left) / z;
            const cy = (ev.clientY - rect.top) / z;
            const alt = ev.altKey || (ev as any).altKey;

            // Create bezier point with control handles
            // The anchor is at mousedown position, control points extend in drag direction
            const dx = cx - point.x;
            const dy = cy - point.y;

            // Incoming control: mirror of outgoing (unless Alt breaks symmetry)
            const cp1x = alt ? point.x : point.x - dx * 0.5;
            const cp1y = alt ? point.y : point.y - dy * 0.5;
            const cp2x = point.x + dx * 0.5;
            const cp2y = point.y + dy * 0.5;

            pts.push({ x: point.x, y: point.y, cx1: cp1x, cy1: cp1y, cx2: cp2x, cy2: cp2y } as any);
            drawPenPreview(content, pts);
          }

          penDragStartRef.current = null;
          penDragActiveRef.current = false;
        };

        document.addEventListener("mousemove", onPenMove);
        document.addEventListener("mouseup", onPenUp);
        return;
      }

      // ── Pen +: add point on an existing path segment ──
      if (tool === "pen-plus") {
        e.stopPropagation();
        e.preventDefault();
        onActivate(frame.id);

        const pathEls = content.querySelectorAll("svg path[d]");
        for (const pathEl of Array.from(pathEls)) {
          const d = pathEl.getAttribute("d");
          if (!d) continue;
          const cmds = parsePathCommands(d);

          // Collect anchor points to check segment midpoints
          const anchors: { cmdIdx: number; x: number; y: number }[] = [];
          for (let i = 0; i < cmds.length; i++) {
            if (cmds[i].type === "M" || cmds[i].type === "L" || cmds[i].type === "C") {
              anchors.push({ cmdIdx: i, x: cmds[i].x, y: cmds[i].y });
            }
          }

          // Find closest segment midpoint
          let bestInsertIdx = -1;
          let bestDist = Infinity;
          let bestMid: { x: number; y: number } | null = null;

          for (let i = 0; i < anchors.length - 1; i++) {
            const a = anchors[i];
            const b = anchors[i + 1];
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            const dist = Math.hypot(mx - mid.x, my - mid.y);
            if (dist < bestDist) {
              bestDist = dist;
              bestInsertIdx = anchors[i + 1].cmdIdx;
              bestMid = mid;
            }
          }

          if (bestDist < 20 && bestMid && bestInsertIdx >= 0) {
            cmds.splice(bestInsertIdx, 0, { type: "L", x: Math.round(bestMid.x), y: Math.round(bestMid.y) });
            pathEl.setAttribute("d", buildPathFromCommands(cmds));
            onCssChangeRef.current?.(frame.id, cssRef.current, content.innerHTML);
            return;
          }
        }
        return;
      }

      // ── Pen -: remove point from an existing path ──
      if (tool === "pen-minus") {
        e.stopPropagation();
        e.preventDefault();
        onActivate(frame.id);

        const pathEls = content.querySelectorAll("svg path[d]");
        for (const pathEl of Array.from(pathEls)) {
          const d = pathEl.getAttribute("d");
          if (!d) continue;
          const cmds = parsePathCommands(d);

          // Find closest anchor point
          let bestIdx = -1;
          let bestDist = Infinity;
          for (let i = 1; i < cmds.length; i++) {
            const cmd = cmds[i];
            if (cmd.type === "L" || cmd.type === "C") {
              const dist = Math.hypot(mx - cmd.x, my - cmd.y);
              if (dist < bestDist) { bestDist = dist; bestIdx = i; }
            }
          }

          const anchorCount = cmds.filter(c => c.type !== "Z").length;
          if (bestDist < 12 && bestIdx >= 0 && anchorCount > 2) {
            cmds.splice(bestIdx, 1);
            pathEl.setAttribute("d", buildPathFromCommands(cmds));
            onCssChangeRef.current?.(frame.id, cssRef.current, content.innerHTML);
            return;
          }
        }
        return;
      }

      // ── Pen edit: convert straight segments to curves with handles ──
      if (tool === "pen-edit") {
        e.stopPropagation();
        e.preventDefault();
        onActivate(frame.id);

        const pathEls = content.querySelectorAll("svg path[d]");
        for (const pathEl of Array.from(pathEls)) {
          const d = pathEl.getAttribute("d");
          if (!d) continue;
          const cmds = parsePathCommands(d);

          // Find closest anchor point
          let bestIdx = -1;
          let bestDist = Infinity;
          for (let i = 0; i < cmds.length; i++) {
            const cmd = cmds[i];
            let px: number | null = null, py: number | null = null;
            if (cmd.type === "M" || cmd.type === "L" || cmd.type === "C") { px = cmd.x; py = cmd.y; }
            if (px === null || py === null) continue;
            const dist = Math.hypot(mx - px, my - py);
            if (dist < bestDist) { bestDist = dist; bestIdx = i; }
          }

          if (bestDist < 12 && bestIdx >= 0) {
            const cmd = cmds[bestIdx];
            const prev = bestIdx > 0 ? cmds[bestIdx - 1] : null;
            const next = bestIdx < cmds.length - 1 ? cmds[bestIdx + 1] : null;

            // Get previous point coords
            let prevX = cmd.x, prevY = cmd.y;
            if (prev && (prev.type === "M" || prev.type === "L" || prev.type === "C")) { prevX = prev.x; prevY = prev.y; }

            // Convert this point's incoming segment from L to C
            if (cmd.type === "L") {
              const dx = cmd.x - prevX;
              const dy = cmd.y - prevY;
              cmds[bestIdx] = { type: "C", cx1: Math.round(prevX + dx * 0.33), cy1: Math.round(prevY + dy * 0.33), cx2: Math.round(prevX + dx * 0.67), cy2: Math.round(prevY + dy * 0.67), x: cmd.x, y: cmd.y };
            }

            // Convert next segment from L to C
            if (next && next.type === "L") {
              const dx = next.x - cmd.x;
              const dy = next.y - cmd.y;
              cmds[bestIdx + 1] = { type: "C", cx1: Math.round(cmd.x + dx * 0.33), cy1: Math.round(cmd.y + dy * 0.33), cx2: Math.round(cmd.x + dx * 0.67), cy2: Math.round(cmd.y + dy * 0.67), x: next.x, y: next.y };
            }

            pathEl.setAttribute("d", buildPathFromCommands(cmds));
            onCssChangeRef.current?.(frame.id, cssRef.current, content.innerHTML);
            return;
          }
        }
        return;
      }

      // ── Pencil: freehand drawing ──
      if (tool === "pencil") {
        e.stopPropagation();
        e.preventDefault();
        onActivate(frame.id);

        const pencilPoints: { x: number; y: number }[] = [{ x: Math.round(mx), y: Math.round(my) }];

        // Ensure preview SVG exists
        if (!penSvgRef.current) {
          const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          Object.assign(svg.style, {
            position: "absolute", top: "0", left: "0",
            width: "100%", height: "100%",
            pointerEvents: "none", zIndex: "9998",
            overflow: "visible",
          });
          svg.setAttribute("width", "100%");
          svg.setAttribute("height", "100%");
          content.appendChild(svg);
          penSvgRef.current = svg;
        }

        const drawPencilPreview = () => {
          const svg = penSvgRef.current;
          if (!svg || pencilPoints.length < 2) return;
          while (svg.firstChild) svg.removeChild(svg.firstChild);
          let pd = `M ${pencilPoints[0].x} ${pencilPoints[0].y}`;
          for (let i = 1; i < pencilPoints.length; i++) {
            pd += ` L ${pencilPoints[i].x} ${pencilPoints[i].y}`;
          }
          const pathEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
          pathEl.setAttribute("d", pd);
          pathEl.setAttribute("fill", "none");
          pathEl.setAttribute("stroke", "#8B5CF6");
          pathEl.setAttribute("stroke-width", "2");
          pathEl.setAttribute("stroke-linecap", "round");
          pathEl.setAttribute("stroke-linejoin", "round");
          svg.appendChild(pathEl);
        };

        const onPencilMove = (ev: MouseEvent) => {
          const cx = Math.round((ev.clientX - rect.left) / z);
          const cy = Math.round((ev.clientY - rect.top) / z);
          const last = pencilPoints[pencilPoints.length - 1];
          if (Math.hypot(cx - last.x, cy - last.y) >= 3) {
            pencilPoints.push({ x: cx, y: cy });
            drawPencilPreview();
          }
        };

        const onPencilUp = () => {
          document.removeEventListener("mousemove", onPencilMove);
          document.removeEventListener("mouseup", onPencilUp);
          if (pencilPoints.length >= 2) {
            penPointsRef.current = pencilPoints.map(p => ({ x: p.x, y: p.y }));
            finalizePenPath(content, false);
          }
        };

        document.addEventListener("mousemove", onPencilMove);
        document.addEventListener("mouseup", onPencilUp);
        return;
      }

      // ── Text tool: click to place text ──
      if (tool === "text") {
        if (target === content) {
          e.stopPropagation();
          onAddPrimitiveRef.current?.("text", Math.round(mx), Math.round(my));
          return;
        }
      }

      // ── Select tool (default) ──
      if (!target || target === content) {
        // Click on empty area: if pen is active with points, finalize path
        if (penPointsRef.current.length >= 2) {
          finalizePenPath(content);
        }
        selectedRef.current = null;
        clearOverlay();
        onElementSelect?.(null);
        return;
      }

      e.stopPropagation();
      onActivate(frame.id);

      // Finalize pen path if active
      if (penPointsRef.current.length >= 2) {
        finalizePenPath(content);
      }

      selectedRef.current = target;
      refreshOverlay(target);

      const computed = shadow.host.ownerDocument.defaultView!.getComputedStyle(target);
      const props: Record<string, string> = {};
      for (const p of TRACKED_PROPS) props[p] = computed.getPropertyValue(p);

      const elTag = target.tagName.toLowerCase();
      const parentSvg = target.closest?.("svg");
      const isSvg = elTag === "svg" || !!parentSvg;
      const svgChildTag = isSvg ? (elTag === "svg" ? undefined : elTag) : undefined;

      onElementSelect?.({
        layerId: target.getAttribute("data-layer-id") || target.tagName.toLowerCase() + "_" + Math.random().toString(36).slice(2, 6),
        tag: elTag,
        selector: getSelector(target),
        computedStyles: props,
        frameId: frame.id,
        isSvg,
        svgChildTag,
      });

      // ── Drag to move (with snap/guides) ──
      const SNAP = 8; // snap threshold in pixels
      const startDragX = me.clientX;
      const startDragY = me.clientY;
      const origLeft = parseInt(computed.left) || target.offsetLeft || 0;
      const origTop = parseInt(computed.top) || target.offsetTop || 0;
      let moved = false;
      let guideLines: HTMLElement[] = [];

      // Collect snap guides from other elements in the frame
      function collectGuides(excludeEl: HTMLElement): { x: number; y: number; w: number; h: number }[] {
        const guides: { x: number; y: number; w: number; h: number }[] = [];
        const zz = zoomRef.current || 1;
        const allEls = content.querySelectorAll("[data-layer-id]");
        const cr = content.getBoundingClientRect();
        for (const el of allEls) {
          if (el === excludeEl) continue;
          const gr = el.getBoundingClientRect();
          guides.push({
            x: (gr.left - cr.left) / zz,
            y: (gr.top - cr.top) / zz,
            w: gr.width / zz,
            h: gr.height / zz,
          });
        }
        // Add frame edges as guides
        guides.push({ x: 0, y: 0, w: 0, h: frame.height }); // left edge
        guides.push({ x: frame.width, y: 0, w: 0, h: frame.height }); // right edge
        guides.push({ x: 0, y: 0, w: frame.width, h: 0 }); // top edge
        guides.push({ x: 0, y: frame.height, w: frame.width, h: 0 }); // bottom edge
        return guides;
      }

      const onDragMove = (ev: MouseEvent) => {
        if (!moved) console.error("[DRAG] onDragMove first move", { frameId: frame.id });
        moved = true;
        const z = zoomRef.current || 1;
        let dx = (ev.clientX - startDragX) / z;
        let dy = (ev.clientY - startDragY) / z;

        // Snap to guides
        const guides = collectGuides(target);
        let snapX = origLeft + dx;
        let snapY = origTop + dy;
        const tw = target.offsetWidth;
        const th = target.offsetHeight;
        const cr = content.getBoundingClientRect();
        const elRect = target.getBoundingClientRect();
        const elW = elRect.width / z;
        const elH = elRect.height / z;

        let snappedX = false, snappedY = false;
        for (const g of guides) {
          // Snap left edge to guide left/right
          if (!snappedX && Math.abs(snapX - g.x) < SNAP) { snapX = g.x; snappedX = true; }
          if (!snappedX && Math.abs(snapX - (g.x + g.w)) < SNAP) { snapX = g.x + g.w; snappedX = true; }
          // Snap right edge to guide left/right
          if (!snappedX && Math.abs(snapX + elW - g.x) < SNAP) { snapX = g.x - elW; snappedX = true; }
          if (!snappedX && Math.abs(snapX + elW - (g.x + g.w)) < SNAP) { snapX = g.x + g.w - elW; snappedX = true; }
          // Snap center to guide center
          if (!snappedX && Math.abs(snapX + elW / 2 - (g.x + g.w / 2)) < SNAP) { snapX = g.x + g.w / 2 - elW / 2; snappedX = true; }
          // Snap top edge to guide top/bottom
          if (!snappedY && Math.abs(snapY - g.y) < SNAP) { snapY = g.y; snappedY = true; }
          if (!snappedY && Math.abs(snapY - (g.y + g.h)) < SNAP) { snapY = g.y + g.h; snappedY = true; }
          // Snap bottom edge to guide top/bottom
          if (!snappedY && Math.abs(snapY + elH - g.y) < SNAP) { snapY = g.y - elH; snappedY = true; }
          if (!snappedY && Math.abs(snapY + elH - (g.y + g.h)) < SNAP) { snapY = g.y + g.h - elH; snappedY = true; }
          // Snap middle to guide middle
          if (!snappedY && Math.abs(snapY + elH / 2 - (g.y + g.h / 2)) < SNAP) { snapY = g.y + g.h / 2 - elH / 2; snappedY = true; }
        }

        // Show visual guide lines
        guideLines.forEach(l => l.remove());
        guideLines = [];
        if (snappedX || snappedY) {
          // Create guide indicator in overlay
          const guideDiv = document.createElement("div");
          Object.assign(guideDiv.style, {
            position: "absolute",
            left: "0", top: "0",
            width: "100%", height: "100%",
            pointerEvents: "none",
            zIndex: "9997",
          });
          overlay.appendChild(guideDiv);
          guideLines.push(guideDiv);

          if (snappedX) {
            const gLine = document.createElement("div");
            Object.assign(gLine.style, {
              position: "absolute",
              left: `${snapX}px`, top: "0",
              width: "1px", height: "100%",
              background: "#EF4444",
              opacity: "0.5",
            });
            guideDiv.appendChild(gLine);
          }
          if (snappedY) {
            const gLine = document.createElement("div");
            Object.assign(gLine.style, {
              position: "absolute",
              left: "0", top: `${snapY}px`,
              width: "100%", height: "1px",
              background: "#EF4444",
              opacity: "0.5",
            });
            guideDiv.appendChild(gLine);
          }
        }

        target.style.position = "absolute";
        target.style.left = `${snapX}px`;
        target.style.top = `${snapY}px`;
        refreshOverlay(target);
      };

      const onDragUp = () => {
        document.removeEventListener("mousemove", onDragMove);
        document.removeEventListener("mouseup", onDragUp);
        console.error("[DRAG] onDragUp fired", { frameId: frame.id, moved });
        if (!moved) return;
        const sel = getSelector(target);
        const updated = updateCssRule(cssRef.current, sel, {
          position: "absolute",
          left: target.style.left,
          top: target.style.top,
        });
        cssRef.current = updated;
        // Record the CSS we're about to emit so the echo-suppression check
        // can skip the re-render that bounces our own change back.
        lastEmittedCssRef.current = updated;
        // Sync BOTH css and html — inline styles (position/left/top) are in the DOM,
        // so content.innerHTML must be saved or reload reverts to original inline styles.
        onCssChangeRef.current?.(frame.id, updated, content.innerHTML);
      };

      document.addEventListener("mousemove", onDragMove);
      document.addEventListener("mouseup", onDragUp);
    });

    // ── Double-click: inline text editing ──
    content.addEventListener("dblclick", (e: Event) => {
      const me = e as MouseEvent;
      const target = me.target as HTMLElement;
      if (!target || target === content) return;
      if (editingTextRef.current) return; // already editing

      // Only allow editing on text-like elements
      const tag = target.tagName.toLowerCase();
      const isTextLike = ["p", "h1", "h2", "h3", "h4", "h5", "h6", "span", "a", "li", "div", "label", "button", "em", "strong", "small", "b", "i"].includes(tag);
      if (!isTextLike) return;

      // Check if element has text content (not just child elements)
      if (target.children.length > 2) return;

      e.stopPropagation();
      e.preventDefault();
      editingTextRef.current = target;

      target.setAttribute("contenteditable", "true");
      target.style.outline = `2px solid ${SEL}`;
      target.style.outlineOffset = "2px";
      target.style.cursor = "text";
      target.focus();

      const onBlur = () => {
        target.removeEventListener("blur", onBlur);
        target.removeAttribute("contenteditable");
        target.style.outline = "";
        target.style.outlineOffset = "";
        target.style.cursor = "";
        editingTextRef.current = null;

        const layerId = target.getAttribute("data-layer-id");
        if (layerId) {
          const newText = target.textContent || "";
          onTextChangeRef.current?.(layerId, newText);
        }
      };

      target.addEventListener("blur", onBlur);

      // Prevent Enter from bubbling to keyboard shortcuts
      target.addEventListener("keydown", (ke: Event) => {
        const kbe = ke as KeyboardEvent;
        if (kbe.key === "Escape") {
          target.blur();
        }
        kbe.stopPropagation();
      });
    });

    // ── Finalize pen path on Enter key (within shadow host context) ──
    shadow.host.addEventListener("keydown", (e: Event) => {
      const kbe = e as KeyboardEvent;
      if (kbe.key === "Enter" && penPointsRef.current.length >= 2) {
        finalizePenPath(content);
      }
      if (kbe.key === "Escape" && penPointsRef.current.length > 0) {
        // Cancel pen path
        penPointsRef.current = [];
        if (penSvgRef.current) {
          penSvgRef.current.remove();
          penSvgRef.current = null;
        }
      }
    });
  }

  function finalizePenPath(content: HTMLElement, closed = false) {
    const pts = penPointsRef.current;
    if (pts.length < 2) return;

    // Build SVG path data (supports bezier curves)
    let pathData = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      if (curr.cx1 !== undefined || curr.cx2 !== undefined) {
        const cx1 = curr.cx1 ?? prev.x;
        const cy1 = curr.cy1 ?? prev.y;
        const cx2 = curr.cx2 ?? curr.x;
        const cy2 = curr.cy2 ?? curr.y;
        pathData += ` C ${cx1} ${cy1}, ${cx2} ${cy2}, ${curr.x} ${curr.y}`;
      } else {
        pathData += ` L ${curr.x} ${curr.y}`;
      }
    }
    if (closed) pathData += " Z";

    // Calculate bounding box (include control points for bezier)
    const allXs: number[] = [];
    const allYs: number[] = [];
    for (const p of pts) {
      allXs.push(p.x); allYs.push(p.y);
      if (p.cx1 !== undefined) { allXs.push(p.cx1); allYs.push(p.cy1); }
      if (p.cx2 !== undefined) { allXs.push(p.cx2); allYs.push(p.cy2); }
    }
    const bounds = {
      x: Math.min(...allXs),
      y: Math.min(...allYs),
      width: Math.max(...allXs) - Math.min(...allXs),
      height: Math.max(...allYs) - Math.min(...allYs),
    };

    onAddPenPathRef.current?.(pathData, bounds, closed);

    // Clean up SVG preview
    penPointsRef.current = [];
    if (penSvgRef.current) {
      penSvgRef.current.remove();
      penSvgRef.current = null;
    }
  }

  function startResize(el: Element, startEvent: MouseEvent, handle: string, ox: number, oy: number, ow: number, oh: number) {
    const startX = startEvent.clientX;
    const startY = startEvent.clientY;
    const target = el as HTMLElement;

    // Determine which edges this handle affects
    const affectsLeft = handle.includes("w");
    const affectsRight = handle.includes("e");
    const affectsTop = handle.includes("n");
    const affectsBottom = handle.includes("s");

    const onMove = (ev: MouseEvent) => {
      const z = zoomRef.current || 1;
      const dx = (ev.clientX - startX) / z;
      const dy = (ev.clientY - startY) / z;

      let newX = ox, newY = oy, newW = ow, newH = oh;

      if (affectsLeft) {
        newX = ox + dx;
        newW = Math.max(10, ow - dx);
        if (newW === 10) newX = ox + ow - 10;
      }
      if (affectsRight) {
        newW = Math.max(10, ow + dx);
      }
      if (affectsTop) {
        newY = oy + dy;
        newH = Math.max(10, oh - dy);
        if (newH === 10) newY = oy + oh - 10;
      }
      if (affectsBottom) {
        newH = Math.max(10, oh + dy);
      }

      target.style.width = `${Math.round(newW)}px`;
      target.style.height = `${Math.round(newH)}px`;
      if (affectsLeft || affectsTop) {
        target.style.position = "absolute";
        if (affectsLeft) target.style.left = `${Math.round(newX)}px`;
        if (affectsTop) target.style.top = `${Math.round(newY)}px`;
      }
      refreshOverlay(el);
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const sel = getSelector(target);
      const props: Record<string, string> = {
        width: target.style.width,
        height: target.style.height,
      };
      if (affectsLeft || affectsTop) {
        props.position = "absolute";
        if (affectsLeft) props.left = target.style.left;
        if (affectsTop) props.top = target.style.top;
      }
      const updated = updateCssRule(cssRef.current, sel, props);
      cssRef.current = updated;
      lastEmittedCssRef.current = updated;
      // Sync BOTH css and html — resize changes width/height inline styles in the DOM.
      const contentEl = shadowRef.current?.getElementById("__df_content");
      onCssChangeRef.current?.(frame.id, updated, contentEl?.innerHTML);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  return (
    <div
      ref={containerRef}
      onClick={() => onActivate(frame.id)}
      style={{
        position: "absolute",
        left: frame.x,
        top: frame.y,
        width: frame.width,
        height: frame.height,
        cursor: activeTool && ["rect", "circle", "triangle", "star", "polygon", "text", "pen", "pen-plus", "pen-minus", "pen-edit", "pencil"].includes(activeTool) ? "crosshair" : "default",
      }}
    >
      {/* Label above frame */}
      <div style={{
        position: "absolute", bottom: "100%", left: 0,
        padding: "2px 8px", marginBottom: 4,
        fontSize: 11, fontFamily: "Inter, system-ui, sans-serif",
        color: isActive ? "#60a5fa" : "#666",
        whiteSpace: "nowrap", pointerEvents: "none",
      }}>
        {frame.name}
        <span style={{ marginLeft: 6, fontSize: 10, color: "#555" }}>
          {frame.width}x{frame.height}
        </span>
      </div>
      {/* Visual border */}
      <div style={{
        position: "absolute", inset: 0,
        border: isActive ? `2px solid ${SEL}` : "1px solid rgba(255,255,255,0.1)",
        borderRadius: 2, pointerEvents: "none", zIndex: 2,
        boxShadow: isActive
          ? `0 0 0 1px ${SEL}, 0 8px 32px rgba(59,130,246,0.15)`
          : "0 4px 16px rgba(0,0,0,0.25)",
      }} />
      {/* Background — pointerEvents:none so clicks pass through to Shadow DOM */}
      <div style={{
        position: "absolute", inset: 0,
        background: frame.background,
        borderRadius: 2,
        pointerEvents: "none",
      }} />
    </div>
  );
}

// ── CSS Utilities ──

function getSelector(el: Element): string {
  const lid = el.getAttribute("data-layer-id");
  if (lid) return `[data-layer-id="${lid}"]`;
  const id = el.id;
  if (id) return `#${id}`;
  const cls = el.className;
  if (typeof cls === "string" && cls.trim()) return `.${cls.trim().split(/\s+/)[0]}`;
  return el.tagName.toLowerCase();
}

function extractFontImports(css: string): string[] {
  const re = /@import\s+url\(['"]?(https:\/\/fonts\.googleapis\.com[^'"]+)['"]?\)/g;
  const hrefs: string[] = [];
  let m;
  while ((m = re.exec(css)) !== null) hrefs.push(m[1]);
  return hrefs;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function updateCssRule(css: string, selector: string, props: Record<string, string>): string {
  const escaped = escapeRegex(selector);
  const ruleRe = new RegExp(`(${escaped}\\s*\\{)([^}]*)(\\})`);
  const match = ruleRe.exec(css);
  if (match) {
    let decl = match[2];
    for (const [prop, value] of Object.entries(props)) {
      const propRe = new RegExp(`${prop}\\s*:[^;]*;?`);
      if (propRe.test(decl)) {
        decl = decl.replace(propRe, `${prop}: ${value};`);
      } else {
        decl = decl.trimEnd() + `\n  ${prop}: ${value};\n`;
      }
    }
    return css.replace(ruleRe, `${match[1]}${decl}${match[3]}`);
  }
  // New rule
  const rule = `\n${selector} {\n${Object.entries(props).map(([k, v]) => `  ${k}: ${v};`).join("\n")}\n}`;
  return css + rule;
}
