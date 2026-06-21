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
  onActivate: (frameId: string) => void;
  onElementSelect?: (info: SelectedElementInfo | null) => void;
  onCssChange?: (frameId: string, newCss: string) => void;
  onHtmlChange?: (frameId: string, newHtml: string) => void;
  activeTool?: HtmlToolName;
  onAddPrimitive?: (type: "rect" | "circle" | "text", x: number, y: number) => void;
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
  frame, isActive, onActivate, onElementSelect, onCssChange, onHtmlChange,
  activeTool, onAddPrimitive,
}: DesignFrameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<ShadowRoot | null>(null);
  const overlayRef = useRef<HTMLElement | null>(null);
  const selectedRef = useRef<Element | null>(null);
  const cssRef = useRef(frame.css);
  const htmlRef = useRef(frame.html);
  const syncLockRef = useRef(false);
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;
  const onAddPrimitiveRef = useRef(onAddPrimitive);
  onAddPrimitiveRef.current = onAddPrimitive;

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
  }, []);

  // ── Code → DOM: CSS update ──
  useEffect(() => {
    if (syncLockRef.current) { syncLockRef.current = false; return; }
    cssRef.current = frame.css;
    const shadow = shadowRef.current;
    if (!shadow) return;
    const style = shadow.querySelector("style");
    if (style) style.textContent = frame.css;
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
    if (syncLockRef.current) { syncLockRef.current = false; return; }
    htmlRef.current = frame.html;
    const shadow = shadowRef.current;
    if (!shadow) return;
    const content = shadow.getElementById("__df_content");
    if (content) content.innerHTML = frame.html;
    selectedRef.current = null;
    clearOverlay();
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
    const x = elRect.left - cRect.left;
    const y = elRect.top - cRect.top;
    const w = elRect.width;
    const h = elRect.height;

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

    // Corner handles
    const corners: [number, number, string][] = [
      [0, 0, "nwse-resize"], [1, 0, "nesw-resize"],
      [0, 1, "nesw-resize"], [1, 1, "nwse-resize"],
    ];
    for (const [cx, cy, cursor] of corners) {
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

  function setupInteraction(shadow: ShadowRoot, content: HTMLElement, overlay: HTMLElement) {
    // Click to add primitive (when rect/circle/text tool is active)
    content.addEventListener("click", (e: Event) => {
      const me = e as MouseEvent;
      const target = me.target as Element;
      // Only trigger when clicking directly on the content area (not on existing elements)
      if (target !== content) return;
      if (!activeToolRef.current || !["rect", "circle", "text"].includes(activeToolRef.current)) return;
      e.stopPropagation();
      const rect = content.getBoundingClientRect();
      const clickX = me.clientX - rect.left;
      const clickY = me.clientY - rect.top;
      onAddPrimitiveRef.current?.(activeToolRef.current as "rect" | "circle" | "text", Math.round(clickX), Math.round(clickY));
    });

    // Click to select
    content.addEventListener("mousedown", (e: Event) => {
      const me = e as MouseEvent;
      const target = me.target as Element;
      if (!target || target === content) {
        selectedRef.current = null;
        clearOverlay();
        onElementSelect?.(null);
        return;
      }
      e.stopPropagation();
      selectedRef.current = target;
      refreshOverlay(target);
      onActivate(frame.id);

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
    });

    // Drag to move
    content.addEventListener("mousedown", (e: Event) => {
      const me = e as MouseEvent;
      const target = me.target as HTMLElement;
      if (!target || target === content || !selectedRef.current) return;

      const startX = me.clientX;
      const startY = me.clientY;
      const computed = shadow.host.ownerDocument.defaultView!.getComputedStyle(target);
      const origLeft = parseInt(computed.left) || target.offsetLeft || 0;
      const origTop = parseInt(computed.top) || target.offsetTop || 0;
      const origPos = computed.position;

      let moved = false;

      const onMove = (ev: MouseEvent) => {
        moved = true;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        target.style.position = "absolute";
        target.style.left = `${origLeft + dx}px`;
        target.style.top = `${origTop + dy}px`;
        refreshOverlay(target);
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        if (!moved) return;
        // DOM → Code sync
        syncLockRef.current = true;
        const sel = getSelector(target);
        const updated = updateCssRule(cssRef.current, sel, {
          position: "absolute",
          left: target.style.left,
          top: target.style.top,
        });
        cssRef.current = updated;
        onCssChange?.(frame.id, updated);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  function startResize(el: Element, startEvent: MouseEvent, _handle: string, ox: number, oy: number, ow: number, oh: number) {
    const startX = startEvent.clientX;
    const startY = startEvent.clientY;
    const target = el as HTMLElement;

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      let newW = ow, newH = oh;
      if (_handle.includes("e") || _handle === "nwse-resize" && ox === 0) newW = Math.max(20, ow + dx);
      if (_handle.includes("w")) newW = Math.max(20, ow - dx);
      if (_handle.includes("s") || _handle === "nwse-resize") newH = Math.max(20, oh + dy);
      if (_handle.includes("n") || _handle === "nesw-resize") newH = Math.max(20, oh - dy);
      target.style.width = `${newW}px`;
      target.style.height = `${newH}px`;
      refreshOverlay(el);
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      syncLockRef.current = true;
      const sel = getSelector(target);
      const updated = updateCssRule(cssRef.current, sel, {
        width: target.style.width,
        height: target.style.height,
      });
      cssRef.current = updated;
      onCssChange?.(frame.id, updated);
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
        cursor: activeTool && ["rect", "circle", "text"].includes(activeTool) ? "crosshair" : "default",
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
      {/* Background */}
      <div style={{
        position: "absolute", inset: 0,
        background: frame.background,
        borderRadius: 2,
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
