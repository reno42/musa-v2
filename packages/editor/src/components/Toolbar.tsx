/**
 * Toolbar Component
 * ──────────────────────────────────────────────────────────────
 * Vertical toolbar with grouped tools, dropdown popups,
 * undo/redo, zoom controls, and export actions.
 *
 * @module components/Toolbar
 */

import { useState, useRef, useEffect } from "react";
import type { ToolName } from "../hooks/useCanvas";
import type { BooleanOperation } from "@futuraria/shared";

type AlignDirection = "left" | "center-h" | "right" | "top" | "center-v" | "bottom";

interface Props {
  tool: ToolName;
  onToolChange: (tool: ToolName) => void;
  onExportPNG: () => void;
  onExportJPG: () => void;
  onExportSVG: () => void;
  onExportJSON: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomToFit: () => void;
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onAlign: (direction: AlignDirection) => void;
  onDistribute: (direction: "horizontal" | "vertical") => void;
  hasMultiSelection: boolean;
  eyedropperColor?: string | null;
  onEyedropperClick?: () => void;
  onAutoLayout?: () => void;
  canBooleanOp: boolean;
  onBooleanOp: (op: BooleanOperation) => void;
  onPrototypePreview?: () => void;
}

export function Toolbar({
  tool, onToolChange,
  onExportPNG, onExportJPG, onExportSVG, onExportJSON,
  onZoomIn, onZoomOut, onZoomToFit, zoom,
  canUndo, canRedo, onUndo, onRedo,
  onAlign, onDistribute, hasMultiSelection,
  onAutoLayout,
  canBooleanOp, onBooleanOp,
  onPrototypePreview,
}: Props) {
  const [alignOpen, setAlignOpen] = useState(false);
  const [boolOpen, setBoolOpen] = useState(false);
  const [shapesOpen, setShapesOpen] = useState(false);
  const [drawOpen, setDrawOpen] = useState(false);

  const alignRef = useRef<HTMLDivElement>(null);
  const boolRef = useRef<HTMLDivElement>(null);
  const shapesRef = useRef<HTMLDivElement>(null);
  const drawRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    if (!alignOpen && !boolOpen && !shapesOpen && !drawOpen) return;
    const handler = (e: MouseEvent) => {
      if (alignRef.current && !alignRef.current.contains(e.target as Node)) setAlignOpen(false);
      if (boolRef.current && !boolRef.current.contains(e.target as Node)) setBoolOpen(false);
      if (shapesRef.current && !shapesRef.current.contains(e.target as Node)) setShapesOpen(false);
      if (drawRef.current && !drawRef.current.contains(e.target as Node)) setDrawOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [alignOpen, boolOpen, shapesOpen, drawOpen]);

  // Close shapes/draw popups when editor area is clicked
  useEffect(() => {
    if (!shapesOpen && !drawOpen && !alignOpen && !boolOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShapesOpen(false);
        setDrawOpen(false);
        setAlignOpen(false);
        setBoolOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shapesOpen, drawOpen, alignOpen, boolOpen]);

  const pickShape = (t: ToolName) => { onToolChange(t); setShapesOpen(false); };
  const pickDraw = (t: ToolName) => { onToolChange(t); setDrawOpen(false); };

  return (
    <div className="toolbar">
      {/* ─── Undo / Redo ─── */}
      <button className={`tool-btn ${!canUndo ? "disabled" : ""}`} onClick={onUndo} disabled={!canUndo} title="Undo (⌘Z)">
        <svg viewBox="0 0 24 24"><path d="M12.5 8c-2.65 0-5.05 1.04-6.83 2.73L3 8v9h9l-3.62-3.62C9.89 12.02 11.12 11.5 12.5 11.5c2.28 0 4.22 1.52 4.84 3.58l2.87-.78C19.36 11.38 16.21 8 12.5 8z" /></svg>
      </button>
      <button className={`tool-btn ${!canRedo ? "disabled" : ""}`} onClick={onRedo} disabled={!canRedo} title="Redo (⌘⇧Z)">
        <svg viewBox="0 0 24 24"><path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.16 0-7.74 2.42-9.44 5.93l2.57 1.11C5.9 12.55 8.47 11 11.5 11c2.09 0 3.99.75 5.47 1.98L13 17h9V8l-3.6 2.6z" /></svg>
      </button>

      <Divider />

      {/* ─── Selection & Navigation ─── */}
      <ToolBtn id="select" tool={tool} onChange={onToolChange} title="Select (V)" shortcut="V">
        <path d="M7 2l12 11.2-5.8.8 3.5 6.1-1.7 1-3.5-6.1L7 19z" />
      </ToolBtn>
      <ToolBtn id="hand" tool={tool} onChange={onToolChange} title="Hand (H)" shortcut="H">
        <path d="M12 2a3 3 0 0 0-3 3v7H8a3 3 0 0 0-3 3v2a7 7 0 0 0 14 0v-6a3 3 0 0 0-3-3h-1V5a3 3 0 0 0-3-3z" />
      </ToolBtn>

      <Divider />

      {/* ─── Draw Group ─── */}
      <div className="align-dropdown-wrapper" ref={drawRef}>
        <button
          className={`tool-btn${["pencil", "pen"].includes(tool) ? " active" : ""} has-submenu`}
          onClick={() => setDrawOpen(!drawOpen)}
          title="Draw Tools"
        >
          <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg>
          <span className="corner-marker"><svg viewBox="0 0 6 6"><path d="M0 6L6 6L6 0Z" fill="currentColor" opacity="0.6"/></svg></span>
        </button>

        {drawOpen && (
          <div className="align-dropdown" style={{ top: -4 }}>
            <div className="align-dropdown-section">
              <span className="align-dropdown-label">Draw</span>
              <div className="align-dropdown-row" style={{ flexDirection: "column", gap: 3 }}>
                <PopupBtn
                  icon={<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />}
                  label="Pencil" shortcut="P"
                  active={tool === "pencil"}
                  onClick={() => pickDraw("pencil")}
                />
                <PopupBtn
                  icon={<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15v-4H7l5-7v4h4l-5 7z" />}
                  label="Pen / Bezier" shortcut="B"
                  active={tool === "pen"}
                  onClick={() => pickDraw("pen")}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <Divider />

      {/* ─── Shapes Group ─── */}
      <div className="align-dropdown-wrapper" ref={shapesRef}>
        <button
          className={`tool-btn${["rect", "ellipse", "line", "triangle", "star", "polygon"].includes(tool) ? " active" : ""} has-submenu`}
          onClick={() => setShapesOpen(!shapesOpen)}
          title="Shapes"
        >
          <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" /></svg>
          <span className="corner-marker"><svg viewBox="0 0 6 6"><path d="M0 6L6 6L6 0Z" fill="currentColor" opacity="0.6"/></svg></span>
        </button>

        {shapesOpen && (
          <div className="align-dropdown" style={{ top: -4 }}>
            <div className="align-dropdown-section">
              <span className="align-dropdown-label">Shapes</span>
              <div className="align-dropdown-row" style={{ flexDirection: "column", gap: 3 }}>
                <PopupBtn icon={<rect x="3" y="3" width="18" height="18" rx="2" />} label="Rectangle" shortcut="R" active={tool === "rect"} onClick={() => pickShape("rect")} />
                <PopupBtn icon={<ellipse cx="12" cy="12" rx="10" ry="10" />} label="Ellipse" shortcut="O" active={tool === "ellipse"} onClick={() => pickShape("ellipse")} />
                <PopupBtn icon={<line x1="5" y1="19" x2="19" y2="5" stroke="currentColor" strokeWidth="2" />} label="Line" shortcut="L" active={tool === "line"} onClick={() => pickShape("line")} />
                <PopupBtn icon={<path d="M12 2L3 22h18L12 2z" />} label="Triangle" active={tool === "triangle"} onClick={() => pickShape("triangle")} />
                <PopupBtn icon={<path d="M12 2l3.1 9.5h9.9l-8 5.8 3 9.7-8-5.8-8 5.8 3-9.7-8-5.8h9.9z" />} label="Star" active={tool === "star"} onClick={() => pickShape("star")} />
                <PopupBtn icon={<path d="M12 2l4 4 4-4 4 4-4 4 4 4-4 4-4-4-4 4-4-4 4-4-4-4z" />} label="Polygon" active={tool === "polygon"} onClick={() => pickShape("polygon")} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── Frame ─── */}
      <ToolBtn id="frame" tool={tool} onChange={onToolChange} title="Frame (F)" shortcut="F">
        <path d="M4 4h16v16H4zM2 2v20h20V2z" fillRule="evenodd" />
      </ToolBtn>

      <Divider />

      {/* ─── Text ─── */}
      <ToolBtn id="text" tool={tool} onChange={onToolChange} title="Text (T)" shortcut="T">
        <path d="M5 4v3h5.5v12h3V7H19V4z" />
      </ToolBtn>

      {/* ─── Image ─── */}
      <ToolBtn id="image" tool={tool} onChange={onToolChange} title="Image (I)" shortcut="I">
        <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
      </ToolBtn>

      <Divider />

      {/* ─── Auto Layout ─── */}
      <button className="tool-btn" onClick={onAutoLayout} title="Auto Layout (⇧A)">
        <svg viewBox="0 0 24 24">
          <rect x="3" y="3" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <span className="shortcut">⇧A</span>
      </button>

      {/* ─── Alignment Dropdown ─── */}
      <div className="align-dropdown-wrapper" ref={alignRef}>
        <button
          className={`tool-btn has-submenu${hasMultiSelection ? "" : " disabled"}`}
          onClick={() => hasMultiSelection && setAlignOpen(!alignOpen)}
          title="Align & Distribute"
          disabled={!hasMultiSelection}
        >
          <svg viewBox="0 0 24 24">
            <path d="M4 4h4v16H4V4zm6 4h4v12h-4V8zm6 2h4v10h-4V10zM2 2v20h20V2H2z" opacity="0.3" />
            <path d="M7 4v16M13 8v12M19 10v10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
          </svg>
          <span className="corner-marker"><svg viewBox="0 0 6 6"><path d="M0 6L6 6L6 0Z" fill="currentColor" opacity="0.6"/></svg></span>
        </button>

        {alignOpen && (
          <div className="align-dropdown">
            <div className="align-dropdown-section">
              <span className="align-dropdown-label">Align</span>
              <div className="align-dropdown-grid">
                <AlignBtn icon={<path d="M3 3v18M6 6h10v4H6zM6 14h14v4H6z" />} title="Align Left" onClick={() => { onAlign("left"); setAlignOpen(false); }} />
                <AlignBtn icon={<><path d="M12 3v18" /><rect x="5" y="6" width="14" height="4" rx="1" /><rect x="7" y="14" width="10" height="4" rx="1" /></>} title="Align Center (H)" onClick={() => { onAlign("center-h"); setAlignOpen(false); }} />
                <AlignBtn icon={<path d="M21 3v18M8 6h10v4H8zM4 14h14v4H4z" />} title="Align Right" onClick={() => { onAlign("right"); setAlignOpen(false); }} />
                <AlignBtn icon={<path d="M3 3h18M6 6v10h4V6zM14 6v14h4V6z" />} title="Align Top" onClick={() => { onAlign("top"); setAlignOpen(false); }} />
                <AlignBtn icon={<><path d="M3 12h18" /><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="7" width="4" height="10" rx="1" /></>} title="Align Middle (V)" onClick={() => { onAlign("center-v"); setAlignOpen(false); }} />
                <AlignBtn icon={<path d="M3 21h18M6 8v10h4V8zM14 4v14h4V4z" />} title="Align Bottom" onClick={() => { onAlign("bottom"); setAlignOpen(false); }} />
              </div>
            </div>
            <div className="align-dropdown-divider" />
            <div className="align-dropdown-section">
              <span className="align-dropdown-label">Distribute</span>
              <div className="align-dropdown-row">
                <AlignBtn icon={<><rect x="2" y="8" width="4" height="8" rx="1" /><rect x="10" y="10" width="4" height="4" rx="1" /><rect x="18" y="8" width="4" height="8" rx="1" /></>} title="Distribute Horizontally" onClick={() => { onDistribute("horizontal"); setAlignOpen(false); }} />
                <AlignBtn icon={<><rect x="8" y="2" width="8" height="4" rx="1" /><rect x="10" y="10" width="4" height="4" rx="1" /><rect x="8" y="18" width="8" height="4" rx="1" /></>} title="Distribute Vertically" onClick={() => { onDistribute("vertical"); setAlignOpen(false); }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── Boolean Operations ─── */}
      <div className="align-dropdown-wrapper" ref={boolRef}>
        <button
          className={`tool-btn has-submenu${canBooleanOp ? "" : " disabled"}`}
          onClick={() => canBooleanOp && setBoolOpen(!boolOpen)}
          title="Boolean Operations"
          disabled={!canBooleanOp}
        >
          <svg viewBox="0 0 24 24">
            <circle cx="9" cy="10" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="15" cy="14" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <span className="corner-marker"><svg viewBox="0 0 6 6"><path d="M0 6L6 6L6 0Z" fill="currentColor" opacity="0.6"/></svg></span>
        </button>

        {boolOpen && (
          <div className="align-dropdown">
            <div className="align-dropdown-section">
              <span className="align-dropdown-label">Boolean</span>
              <div className="align-dropdown-grid">
                <AlignBtn icon={<><circle cx="9" cy="10" r="6" fill="currentColor" opacity="0.4" /><circle cx="15" cy="14" r="6" fill="currentColor" opacity="0.4" /></>} title="Union" onClick={() => { onBooleanOp("union"); setBoolOpen(false); }} />
                <AlignBtn icon={<><circle cx="9" cy="10" r="6" fill="currentColor" opacity="0.4" /><circle cx="15" cy="14" r="6" fill="currentColor" opacity="0.15" /><circle cx="15" cy="14" r="6" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" /></>} title="Subtract" onClick={() => { onBooleanOp("subtract"); setBoolOpen(false); }} />
                <AlignBtn icon={<><circle cx="9" cy="10" r="6" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.4" /><circle cx="15" cy="14" r="6" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.4" /><ellipse cx="12" cy="12" rx="3.5" ry="5" fill="currentColor" opacity="0.4" /></>} title="Intersect" onClick={() => { onBooleanOp("intersect"); setBoolOpen(false); }} />
                <AlignBtn icon={<><circle cx="9" cy="10" r="6" fill="currentColor" opacity="0.3" /><circle cx="15" cy="14" r="6" fill="currentColor" opacity="0.3" /><ellipse cx="12" cy="12" rx="3.5" ry="5" fill="#1e1e2e" /></>} title="Exclude" onClick={() => { onBooleanOp("exclude"); setBoolOpen(false); }} />
              </div>
            </div>
            <div className="align-dropdown-divider" />
            <div style={{ padding: "4px 8px", color: "#888", fontSize: 11 }}>Select 2+ shapes to combine</div>
          </div>
        )}
      </div>

      <Divider />

      {/* ─── Zoom ─── */}
      <button className="tool-btn" onClick={onZoomOut} title="Zoom Out (-)">
        <svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14zM7 9h5v1H7z" /></svg>
      </button>
      <div className="tool-btn zoom-display">{Math.round(zoom * 100)}%</div>
      <button className="tool-btn" onClick={onZoomIn} title="Zoom In (+)">
        <svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14zM12 10h-2v2H9v-2H7V9h2V7h1v2h2v1z" /></svg>
      </button>
      <button className="tool-btn" onClick={onZoomToFit} title="Fit to screen (⌘1)">
        <svg viewBox="0 0 24 24"><path d="M3 5v4h2V5h4V3H5a2 2 0 0 0-2 2zm16-2h-4v2h4v4h2V5a2 2 0 0 0-2-2zM5 19h4v2H5a2 2 0 0 1-2-2v-4h2v4zm14 0v-4h2v4a2 2 0 0 1-2 2h-4v-2h4z" /></svg>
      </button>

      <Spacer />

      {/* ─── Prototype Preview ─── */}
      {onPrototypePreview && (
        <button className="tool-btn proto-toolbar-btn" onClick={onPrototypePreview} title="Prototype Preview (⌘P)">
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
        </button>
      )}

      {/* ─── Export Group ─── */}
      <div className="export-group">
        <button className="tool-btn" onClick={onExportPNG} title="Export PNG">
          <svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" /></svg>
        </button>
        <button className="tool-btn" onClick={onExportSVG} title="Export SVG">
          <svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" /></svg>
        </button>
        <button className="tool-btn" onClick={onExportJSON} title="Export JSON">
          <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2l5 5h-5V4zM6 20V4h5v7h7v9H6z" /></svg>
        </button>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────

function ToolBtn({ id, tool, onChange, title, shortcut, children }: {
  id: ToolName; tool: ToolName; onChange: (t: ToolName) => void;
  title: string; shortcut?: string; children: React.ReactNode;
}) {
  return (
    <button className={`tool-btn ${tool === id ? "active" : ""}`} onClick={() => onChange(id)} title={title}>
      <svg viewBox="0 0 24 24">{children}</svg>
      {shortcut && <span className="shortcut">{shortcut}</span>}
    </button>
  );
}

function AlignBtn({ icon, title, onClick }: { icon: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <button className="align-dropdown-btn" onClick={onClick} title={title}>
      <svg viewBox="0 0 24 24">{icon}</svg>
    </button>
  );
}

function PopupBtn({ icon, label, shortcut, active, onClick }: {
  icon: React.ReactNode; label: string; shortcut?: string;
  active: boolean; onClick: () => void;
}) {
  return (
    <button
      className={`popup-item-btn${active ? " active" : ""}`}
      onClick={onClick}
      title={label + (shortcut ? ` (${shortcut})` : "")}
    >
      <svg viewBox="0 0 24 24" className="popup-item-icon">{icon}</svg>
      <span className="popup-item-label">{label}</span>
      {shortcut && <span className="popup-item-shortcut">{shortcut}</span>}
    </button>
  );
}

function Divider() { return <div className="toolbar-divider" />; }
function Spacer() { return <div className="toolbar-spacer" />; }
