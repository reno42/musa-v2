import { useState, useRef, useCallback, useEffect, type CSSProperties } from "react";

/**
 * CanvasGuides — Figma-style rulers, guides, pixel grid, column guides,
 * and smart guides for the InfiniteHtmlCanvas.
 *
 * Renders as a fixed overlay (screen coordinates) on top of the canvas.
 * Rulers are interactive (drag to create guides). Everything else is
 * pointer-events: none (visual only).
 */

export interface Guide {
  id: string;
  orientation: "h" | "v";
  position: number; // canvas coordinate
}

export interface ColumnConfig {
  count: number;
  gutter: number; // space between columns in px
  margin: number; // left/right margin in px
}

export interface SmartGuide {
  type: "align" | "spacing";
  orientation: "h" | "v";
  position: number;
  length: number;
  start: number;
  label?: string;
}

interface CanvasGuidesProps {
  pan: { x: number; y: number };
  zoom: number;
  guides: Guide[];
  onGuidesChange: (guides: Guide[]) => void;
  showGrid: boolean;
  gridSize: number;
  showRulers: boolean;
  columnConfig: ColumnConfig | null;
  columnFrameBounds: { x: number; y: number; width: number; height: number } | null;
  smartGuides: SmartGuide[];
}

const RULER_SIZE = 20;
const GUIDE_COLOR = "#3B82F6";
const SMART_GUIDE_COLOR = "#EC4899";
const SPACING_COLOR = "#10B981";
const COLUMN_COLOR = "rgba(96, 165, 250, 0.4)";

let guideSeq = 0;
function makeGuideId() {
  guideSeq++;
  return `guide_${Date.now().toString(36)}_${guideSeq}`;
}

export function CanvasGuides({
  pan, zoom, guides, onGuidesChange,
  showGrid, gridSize, showRulers,
  columnConfig, columnFrameBounds, smartGuides,
}: CanvasGuidesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [dragGuide, setDragGuide] = useState<{ orientation: "h" | "v"; pos: number } | null>(null);
  const [hoverGuideId, setHoverGuideId] = useState<string | null>(null);

  // Track container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Coordinate conversion helpers ──
  // screen = canvas * zoom + pan
  // canvas = (screen - pan) / zoom
  const screenToCanvasX = useCallback((sx: number) => (sx - pan.x) / zoom, [pan.x, zoom]);
  const screenToCanvasY = useCallback((sy: number) => (sy - pan.y) / zoom, [pan.y, zoom]);
  const canvasXToScreen = useCallback((cx: number) => cx * zoom + pan.x, [pan.x, zoom]);
  const canvasYToScreen = useCallback((cy: number) => cy * zoom + pan.y, [pan.y, zoom]);

  // ── Ruler tick calculation ──
  // Choose a "nice" interval based on zoom so ticks are ~50-100px apart on screen
  const getRulerInterval = useCallback(() => {
    const targetScreenPx = 80; // aim for ~80px between major ticks
    const canvasInterval = targetScreenPx / zoom;
    const candidates = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000];
    for (const c of candidates) {
      if (c >= canvasInterval) return c;
    }
    return 2000;
  }, [zoom]);

  const rulerInterval = getRulerInterval();

  // ── Ruler mouse handlers ──
  const handleRulerMouseDown = useCallback((orientation: "h" | "v", e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const startCanvasPos = orientation === "h"
      ? screenToCanvasY(e.clientY - rect.top)
      : screenToCanvasX(e.clientX - rect.left);
    setDragGuide({ orientation, pos: startCanvasPos });

    const onMove = (me: MouseEvent) => {
      const p = orientation === "h"
        ? screenToCanvasY(me.clientY - rect.top)
        : screenToCanvasX(me.clientX - rect.left);
      setDragGuide({ orientation, pos: p });
    };
    const onUp = (me: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      // Only create if dropped inside canvas (not back on ruler)
      const screenPos = orientation === "h" ? me.clientY - rect.top : me.clientX - rect.left;
      if (screenPos > RULER_SIZE) {
        const finalPos = orientation === "h"
          ? screenToCanvasY(me.clientY - rect.top)
          : screenToCanvasX(me.clientX - rect.left);
        onGuidesChange([...guides, { id: makeGuideId(), orientation, position: Math.round(finalPos) }]);
      }
      setDragGuide(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [screenToCanvasX, screenToCanvasY, guides, onGuidesChange]);

  // ── Guide deletion (drag back to ruler) ──
  const handleGuideMouseDown = useCallback((guide: Guide, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    let removed = false;

    const onMove = (me: MouseEvent) => {
      const screenPos = guide.orientation === "h" ? me.clientY - rect.top : me.clientX - rect.left;
      if (screenPos <= RULER_SIZE) {
        // Dragged back to ruler — remove
        if (!removed) {
          removed = true;
          onGuidesChange(guides.filter(g => g.id !== guide.id));
        }
      }
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [guides, onGuidesChange]);

  // ── Render ruler ticks ──
  const renderRulerTicks = (orientation: "h" | "v") => {
    const isH = orientation === "h";
    const startCanvas = isH ? screenToCanvasY(0) : screenToCanvasX(0);
    const endCanvas = isH ? screenToCanvasY(size.h) : screenToCanvasX(size.w);
    const firstTick = Math.floor(startCanvas / rulerInterval) * rulerInterval;
    const lastTick = Math.ceil(endCanvas / rulerInterval) * rulerInterval;
    const ticks: React.ReactElement[] = [];
    for (let pos = firstTick; pos <= lastTick; pos += rulerInterval) {
      const screenPos = isH ? canvasYToScreen(pos) : canvasXToScreen(pos);
      if (screenPos < RULER_SIZE) continue;
      const label = Math.round(pos);
      if (isH) {
        ticks.push(
          <div key={`tick-${pos}`} style={{
            position: "absolute", top: screenPos, left: 0,
            width: RULER_SIZE, height: 1, background: "rgba(255,255,255,0.25)",
          }}>
            <span style={{
              position: "absolute", left: 2, top: -7,
              fontSize: 8, color: "rgba(255,255,255,0.5)",
              fontFamily: "monospace", whiteSpace: "nowrap",
            }}>{label}</span>
          </div>
        );
      } else {
        ticks.push(
          <div key={`tick-${pos}`} style={{
            position: "absolute", left: screenPos, top: 0,
            width: 1, height: RULER_SIZE, background: "rgba(255,255,255,0.25)",
          }}>
            <span style={{
              position: "absolute", top: 2, left: 2,
              fontSize: 8, color: "rgba(255,255,255,0.5)",
              fontFamily: "monospace",
              transform: "rotate(-90deg) translateX(-100%)",
              transformOrigin: "left top",
              whiteSpace: "nowrap",
            }}>{label}</span>
          </div>
        );
      }
      // Minor ticks
      const minorInterval = rulerInterval / 5;
      for (let m = 1; m < 5; m++) {
        const minorPos = pos + m * minorInterval;
        const minorScreen = isH ? canvasYToScreen(minorPos) : canvasXToScreen(minorPos);
        if (minorScreen < RULER_SIZE || minorScreen > (isH ? size.h : size.w)) continue;
        if (isH) {
          ticks.push(<div key={`minor-${minorPos}`} style={{ position: "absolute", top: minorScreen, right: 0, width: 4, height: 1, background: "rgba(255,255,255,0.12)" }} />);
        } else {
          ticks.push(<div key={`minor-${minorPos}`} style={{ position: "absolute", left: minorScreen, bottom: 0, width: 1, height: 4, background: "rgba(255,255,255,0.12)" }} />);
        }
      }
    }
    return ticks;
  };

  // ── Pixel grid ──
  const gridScreenSize = gridSize * zoom;
  const gridOffsetX = pan.x % gridScreenSize;
  const gridOffsetY = pan.y % gridScreenSize;

  // ── Column guides for active frame ──
  const renderColumnGuides = () => {
    if (!columnConfig || columnConfig.count <= 0 || !columnFrameBounds) return null;
    const { x: fx, y: fy, width: fw } = columnFrameBounds;
    const screenTop = canvasYToScreen(fy);
    const margin = columnConfig.margin;
    const gutter = columnConfig.gutter;
    const contentWidth = fw - margin * 2;
    const totalGutter = gutter * (columnConfig.count - 1);
    const colWidth = Math.max(0, (contentWidth - totalGutter) / columnConfig.count);

    const cols: React.ReactElement[] = [];
    for (let i = 0; i < columnConfig.count; i++) {
      const colCanvasX = fx + margin + i * (colWidth + gutter);
      const screenX = canvasXToScreen(colCanvasX);
      const screenW = colWidth * zoom;
      cols.push(
        <div key={`col-${i}`} style={{
          position: "absolute",
          left: screenX,
          top: screenTop,
          width: screenW,
          height: columnFrameBounds.height * zoom,
          background: COLUMN_COLOR,
          pointerEvents: "none",
        }} />
      );
    }
    return cols;
  };

  if (!showRulers && !showGrid && !columnConfig && guides.length === 0) return null;

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute", inset: 0,
        // Below the dockable panels (z-index 15 docked / 25 dragging, see
        // useDockablePanel) — the canvas is now inset to stop before a
        // docked panel, but a panel being actively dragged floats freely
        // and should always render on top of the ruler if it happens to
        // pass over it, never the other way around.
        pointerEvents: "none", zIndex: 10,
      }}
    >
      {/* ═══ Pixel Grid ═══ */}
      {showGrid && gridScreenSize >= 4 && (
        <div style={{
          position: "absolute", inset: 0,
          backgroundImage: `
            linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px)
          `,
          backgroundSize: `${gridScreenSize}px ${gridScreenSize}px`,
          backgroundPosition: `${gridOffsetX}px ${gridOffsetY}px`,
          pointerEvents: "none",
        }} />
      )}

      {/* ═══ Smart Guides ═══ */}
      {smartGuides.map((sg, i) => {
        if (sg.orientation === "h") {
          const screenY = canvasYToScreen(sg.position);
          const screenStart = canvasXToScreen(sg.start);
          const screenLen = sg.length * zoom;
          return (
            <div key={`sg-${i}`} style={{
              position: "absolute",
              left: screenStart, top: screenY,
              width: screenLen, height: 1,
              background: sg.type === "spacing" ? SPACING_COLOR : SMART_GUIDE_COLOR,
              pointerEvents: "none",
            }}>
              {sg.label && (
                <span style={{
                  position: "absolute", top: -14, left: screenLen / 2,
                  transform: "translateX(-50%)",
                  fontSize: 9, color: SPACING_COLOR,
                  fontFamily: "monospace", fontWeight: 600,
                  background: "rgba(0,0,0,0.7)", padding: "1px 4px", borderRadius: 3,
                }}>{sg.label}</span>
              )}
            </div>
          );
        } else {
          const screenX = canvasXToScreen(sg.position);
          const screenStart = canvasYToScreen(sg.start);
          const screenLen = sg.length * zoom;
          return (
            <div key={`sg-${i}`} style={{
              position: "absolute",
              left: screenX, top: screenStart,
              width: 1, height: screenLen,
              background: sg.type === "spacing" ? SPACING_COLOR : SMART_GUIDE_COLOR,
              pointerEvents: "none",
            }}>
              {sg.label && (
                <span style={{
                  position: "absolute", left: 4, top: screenLen / 2,
                  transform: "translateY(-50%)",
                  fontSize: 9, color: SPACING_COLOR,
                  fontFamily: "monospace", fontWeight: 600,
                  background: "rgba(0,0,0,0.7)", padding: "1px 4px", borderRadius: 3,
                }}>{sg.label}</span>
              )}
            </div>
          );
        }
      })}

      {/* ═══ User Guides (draggable lines) ═══ */}
      {guides.map(g => {
        if (g.orientation === "h") {
          const screenY = canvasYToScreen(g.position);
          if (screenY < 0 || screenY > size.h) return null;
          return (
            <div
              key={g.id}
              onMouseDown={(e) => handleGuideMouseDown(g, e)}
              onMouseEnter={() => setHoverGuideId(g.id)}
              onMouseLeave={() => setHoverGuideId(null)}
              style={{
                position: "absolute", left: 0, top: screenY,
                width: "100%", height: 1,
                background: GUIDE_COLOR,
                cursor: "ns-resize",
                pointerEvents: "auto",
                boxShadow: hoverGuideId === g.id ? "0 0 4px rgba(59,130,246,0.6)" : "none",
              }}
            >
              <div style={{
                position: "absolute", left: RULER_SIZE, top: -6,
                width: 8, height: 12, background: GUIDE_COLOR,
                clipPath: "polygon(0 50%, 100% 0, 100% 100%)",
              }} />
            </div>
          );
        } else {
          const screenX = canvasXToScreen(g.position);
          if (screenX < 0 || screenX > size.w) return null;
          return (
            <div
              key={g.id}
              onMouseDown={(e) => handleGuideMouseDown(g, e)}
              onMouseEnter={() => setHoverGuideId(g.id)}
              onMouseLeave={() => setHoverGuideId(null)}
              style={{
                position: "absolute", left: screenX, top: 0,
                width: 1, height: "100%",
                background: GUIDE_COLOR,
                cursor: "ew-resize",
                pointerEvents: "auto",
                boxShadow: hoverGuideId === g.id ? "0 0 4px rgba(59,130,246,0.6)" : "none",
              }}
            >
              <div style={{
                position: "absolute", top: RULER_SIZE, left: -6,
                width: 12, height: 8, background: GUIDE_COLOR,
                clipPath: "polygon(50% 0, 0 100%, 100% 100%)",
              }} />
            </div>
          );
        }
      })}

      {/* ═══ Drag preview guide ═══ */}
      {dragGuide && (
        dragGuide.orientation === "h" ? (
          <div style={{
            position: "absolute", left: 0, top: canvasYToScreen(dragGuide.pos),
            width: "100%", height: 1, background: GUIDE_COLOR,
            pointerEvents: "none",
          }} />
        ) : (
          <div style={{
            position: "absolute", left: canvasXToScreen(dragGuide.pos), top: 0,
            width: 1, height: "100%", background: GUIDE_COLOR,
            pointerEvents: "none",
          }} />
        )
      )}

      {/* ═══ Column guides overlay ═══ */}
      {renderColumnGuides()}

      {/* ═══ Rulers ═══ */}
      {showRulers && (
        <>
          {/* Top ruler */}
          <div
            onMouseDown={(e) => handleRulerMouseDown("v", e)}
            style={{
              position: "absolute", top: 0, left: RULER_SIZE,
              right: 0, height: RULER_SIZE,
              background: "rgba(30,30,30,0.95)",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
              overflow: "hidden", cursor: "ew-resize",
              pointerEvents: "auto",
            }}
          >
            {renderRulerTicks("v")}
          </div>

          {/* Left ruler */}
          <div
            onMouseDown={(e) => handleRulerMouseDown("h", e)}
            style={{
              position: "absolute", top: RULER_SIZE, left: 0,
              width: RULER_SIZE, bottom: 0,
              background: "rgba(30,30,30,0.95)",
              borderRight: "1px solid rgba(255,255,255,0.08)",
              overflow: "hidden", cursor: "ns-resize",
              pointerEvents: "auto",
            }}
          >
            {renderRulerTicks("h")}
          </div>

          {/* Corner */}
          <div style={{
            position: "absolute", top: 0, left: 0,
            width: RULER_SIZE, height: RULER_SIZE,
            background: "rgba(20,20,20,0.98)",
            borderRight: "1px solid rgba(255,255,255,0.08)",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            pointerEvents: "auto",
          }} />
        </>
      )}
    </div>
  );
}
