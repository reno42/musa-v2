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
  onAddPenPath?: (pathData: string, bounds: { x: number; y: number; width: number; height: number }) => void;
  onElementDelete?: (layerId: string) => void;
  onElementDuplicate?: (layerId: string) => void;
}

const SEL = "#3B82F6";
const HANDLE = 7;

const TRACKED_PROPS = [
  "font-family", "font-size", "font-weight", "font-style",
  "color", "background-color", "background",
  "margin", "padding", "border", "border-radius",
  "width", "height", "max-width", "max-height",
  "position", "top", "left", "right", "bottom",
  "display", "flex-direction", "gap", "align-items", "justify-content",
  "text-align", "line-height", "letter-spacing",
  "text-decoration", "text-transform",
  "opacity", "box-shadow", "text-shadow",
];

export function DesignFrame({
  frame, isActive, zoom, onActivate, onElementSelect, onCssChange, onHtmlChange,
  activeTool, onAddPrimitive, onDrawShape, onTextChange, onAddPenPath, onElementDelete, onElementDuplicate,
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
  }

  function refreshOverlay(el: Element) {
    const overlay = overlayRef.current;
    const shadow = shadowRef.current;
    if (!overlay || !shadow) return;
    overlay.innerHTML = "";

    const content = shadow.getElementById("__df_content")!;
    const elRect = el.getBoundingClientRect();
    const cRect = content.getBoundingClientRect();
    const z = zoomRef.current || 1;
    const x = (elRect.left - cRect.left) / z;
    const y = (elRect.top - cRect.top) / z;
    const w = elRect.width / z;
    const h = elRect.height / z;

    // Selection border
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

    // Corner + midpoint handles (8 total)
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

  const penPointsRef = useRef<{x: number; y: number}[]>([]);
  const penSvgRef = useRef<SVGElement | null>(null);

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
      const mx = me.clientX - rect.left;
      const my = me.clientY - rect.top;

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
          const cx = ev.clientX - rect.left;
          const cy = ev.clientY - rect.top;
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

          const cx = ev.clientX - rect.left;
          const cy = ev.clientY - rect.top;
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

      // ── Pen tool: click to add points ──
      if (tool === "pen") {
        e.stopPropagation();
        e.preventDefault();
        onActivate(frame.id);

        const point = { x: Math.round(mx), y: Math.round(my) };
        penPointsRef.current.push(point);

        // Draw/update SVG polyline in shadow DOM
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
        // Clear and redraw
        while (svg.firstChild) svg.removeChild(svg.firstChild);
        const pts = penPointsRef.current;

        // Draw polyline
        if (pts.length > 1) {
          const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
          polyline.setAttribute("points", pts.map(p => `${p.x},${p.y}`).join(" "));
          polyline.setAttribute("fill", "none");
          polyline.setAttribute("stroke", "#8B5CF6");
          polyline.setAttribute("stroke-width", "2");
          polyline.setAttribute("stroke-dasharray", "6,3");
          svg.appendChild(polyline);
        }

        // Draw point dots
        for (const p of pts) {
          const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          circle.setAttribute("cx", `${p.x}`);
          circle.setAttribute("cy", `${p.y}`);
          circle.setAttribute("r", "4");
          circle.setAttribute("fill", "#8B5CF6");
          circle.setAttribute("stroke", "#fff");
          circle.setAttribute("stroke-width", "1.5");
          svg.appendChild(circle);
        }
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

      onElementSelect?.({
        layerId: target.getAttribute("data-layer-id") || target.tagName.toLowerCase() + "_" + Math.random().toString(36).slice(2, 6),
        tag: target.tagName.toLowerCase(),
        selector: getSelector(target),
        computedStyles: props,
        frameId: frame.id,
      });

      // ── Drag to move ──
      const startDragX = me.clientX;
      const startDragY = me.clientY;
      const origLeft = parseInt(computed.left) || target.offsetLeft || 0;
      const origTop = parseInt(computed.top) || target.offsetTop || 0;
      let moved = false;

      const onDragMove = (ev: MouseEvent) => {
        if (!moved) console.error("[DRAG] onDragMove first move", { frameId: frame.id });
        moved = true;
        const z = zoomRef.current || 1;
        const dx = (ev.clientX - startDragX) / z;
        const dy = (ev.clientY - startDragY) / z;
        target.style.position = "absolute";
        target.style.left = `${origLeft + dx}px`;
        target.style.top = `${origTop + dy}px`;
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

  function finalizePenPath(content: HTMLElement) {
    const pts = penPointsRef.current;
    if (pts.length < 2) return;

    // Build SVG path data
    let pathData = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      pathData += ` L ${pts[i].x} ${pts[i].y}`;
    }

    // Calculate bounding box
    const xs = pts.map(p => p.x);
    const ys = pts.map(p => p.y);
    const bounds = {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };

    onAddPenPathRef.current?.(pathData, bounds);

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
        cursor: activeTool && ["rect", "circle", "triangle", "star", "polygon", "text", "pen"].includes(activeTool) ? "crosshair" : "default",
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
