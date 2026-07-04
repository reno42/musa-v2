import { useState, useRef, useEffect } from "react";
import type { HtmlToolName } from "./InfiniteHtmlCanvas";
import {
  IconPointer, IconHand, IconRectangle, IconCircleOutline, IconType, IconPen,
  IconFrame, IconZoomIn, IconZoomOut, IconMaximize,
  IconChevronDown, IconTriangle, IconStar, IconHexagon,
} from "../shared/icons";

interface Props {
  tool: HtmlToolName;
  onToolChange: (t: HtmlToolName) => void;
  onAddFrame: (preset: { name: string; width: number; height: number }) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomToFit: () => void;
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

const FRAME_PRESETS = [
  { name: "IG Square", width: 1080, height: 1080, label: "1080²" },
  { name: "IG Story", width: 1080, height: 1920, label: "1080×1920" },
  { name: "IG Feed", width: 1080, height: 1350, label: "1080×1350" },
  { name: "Banner", width: 1920, height: 1080, label: "1920×1080" },
  { name: "Twitter", width: 1200, height: 628, label: "1200×628" },
];

export function FloatingToolbar({
  tool, onToolChange, onAddFrame,
  onZoomIn, onZoomOut, onZoomToFit, zoom,
  canUndo, canRedo, onUndo, onRedo,
}: Props) {
  const [showFrameMenu, setShowFrameMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close frame menu on outside click
  useEffect(() => {
    if (!showFrameMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowFrameMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showFrameMenu]);

  const toolBtn = (name: HtmlToolName, icon: React.ReactNode, shortcut: string, title: string) => (
    <button
      type="button"
      onClick={() => onToolChange(name)}
      title={`${title} (${shortcut})`}
      style={{
        width: 36, height: 36,
        display: "flex", alignItems: "center", justifyContent: "center",
        borderRadius: 8, cursor: "pointer",
        background: tool === name ? "var(--accent-dim, rgba(200,184,152,0.15))" : "transparent",
        border: tool === name ? "1px solid var(--accent, #c8b898)" : "1px solid transparent",
        color: tool === name ? "var(--accent, #c8b898)" : "var(--text-muted, #7a7668)",
        transition: "all 0.15s ease",
        position: "relative",
      }}
    >
      {icon}
      <span style={{
        position: "absolute", bottom: 1, right: 2,
        fontSize: 8, fontFamily: "SF Mono, monospace",
        color: "var(--text-muted, #7a7668)", opacity: 0.6,
      }}>{shortcut}</span>
    </button>
  );

  const actionBtn = (icon: React.ReactNode, onClick: () => void, title: string, disabled?: boolean) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        width: 36, height: 36,
        display: "flex", alignItems: "center", justifyContent: "center",
        borderRadius: 8, cursor: disabled ? "not-allowed" : "pointer",
        background: "transparent", border: "1px solid transparent",
        color: disabled ? "rgba(122,118,104,0.3)" : "var(--text-muted, #7a7668)",
        transition: "all 0.15s ease", opacity: disabled ? 0.4 : 1,
      }}
    >
      {icon}
    </button>
  );

  const divider = (
    <div style={{ width: 28, height: 1, background: "var(--border-color, rgba(255,255,255,0.06))", margin: "4px auto" }} />
  );

  return (
    <div style={{
      background: "var(--glass-bg, rgba(12,12,12,0.65))",
      backdropFilter: "blur(20px) saturate(180%)",
      WebkitBackdropFilter: "blur(20px) saturate(180%)",
      border: "1px solid var(--glass-border, rgba(255,255,255,0.06))",
      borderRadius: 14,
      boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      padding: "8px 6px",
      display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
    }}>
      {/* Tools */}
      {toolBtn("select", <IconPointer size={16} />, "V", "Select — click to select, drag to move")}
      {toolBtn("hand", <IconHand size={16} />, "H", "Hand — drag to pan the canvas")}

      {divider}

      {toolBtn("rect", <IconRectangle size={16} />, "R", "Rectangle — click-drag to draw")}
      {toolBtn("circle", <IconCircleOutline size={16} />, "O", "Circle — click-drag to draw")}
      {toolBtn("triangle", <IconTriangle size={16} />, "G", "Triangle — click-drag to draw")}
      {toolBtn("star", <IconStar size={16} />, "S", "Star — click-drag to draw")}
      {toolBtn("polygon", <IconHexagon size={16} />, "N", "Polygon — click-drag to draw (Shift for sides)")}
      {toolBtn("text", <IconType size={16} />, "T", "Text — click to place text block")}
      {toolBtn("pen", <IconPen size={16} />, "P", "Pen — click to add points, Enter to finalize")}

      {divider}

      {/* Frame presets dropdown */}
      <div ref={menuRef} style={{ position: "relative" }}>
        <button
          type="button"
          onClick={() => setShowFrameMenu(!showFrameMenu)}
          title="Add Frame — choose preset size"
          style={{
            width: 36, height: 36,
            display: "flex", alignItems: "center", justifyContent: "center",
            borderRadius: 8, cursor: "pointer",
            background: showFrameMenu ? "var(--accent-dim, rgba(200,184,152,0.15))" : "transparent",
            border: showFrameMenu ? "1px solid var(--accent, #c8b898)" : "1px solid transparent",
            color: "var(--text-muted, #7a7668)",
            transition: "all 0.15s ease",
          }}
        >
          <IconFrame size={16} />
          <IconChevronDown size={8} style={{ position: "absolute", bottom: 2, right: 2, opacity: 0.5 }} />
        </button>

        {showFrameMenu && (
          <div style={{
            position: "absolute", left: 44, top: 0, zIndex: 30,
            background: "var(--glass-bg, rgba(12,12,12,0.85))",
            backdropFilter: "blur(20px) saturate(180%)",
            border: "1px solid var(--glass-border, rgba(255,255,255,0.06))",
            borderRadius: 10, padding: 6, minWidth: 180,
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          }}>
            {FRAME_PRESETS.map(p => (
              <button
                key={p.name}
                type="button"
                onClick={() => { onAddFrame(p); setShowFrameMenu(false); }}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  width: "100%", padding: "6px 10px",
                  background: "transparent", border: "1px solid transparent",
                  borderRadius: 6, color: "var(--text-main, #c4c0b4)",
                  cursor: "pointer", fontSize: 12, fontFamily: "inherit",
                  transition: "all 0.1s",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "var(--accent-dim, rgba(200,184,152,0.1))";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                }}
              >
                <span>{p.name}</span>
                <span style={{ fontSize: 10, color: "var(--text-muted, #7a7668)", fontFamily: "SF Mono, monospace" }}>{p.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {divider}

      {/* Undo / Redo */}
      {actionBtn(
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12.5 8c-2.65 0-5.05 1.04-6.83 2.73L3 8v9h9l-3.62-3.62C9.89 12.02 11.12 11.5 12.5 11.5c2.28 0 4.22 1.52 4.84 3.58l2.87-.78C19.36 11.38 16.21 8 12.5 8z"/></svg>,
        onUndo, "Undo (Ctrl+Z)", !canUndo,
      )}
      {actionBtn(
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.16 0-7.74 2.42-9.44 5.93l2.57 1.11C5.9 12.55 8.47 11 11.5 11c2.09 0 3.99.75 5.47 1.98L13 17h9V8l-3.6 2.6z"/></svg>,
        onRedo, "Redo (Ctrl+Shift+Z)", !canRedo,
      )}

      {divider}

      {/* Zoom */}
      {actionBtn(<IconZoomOut size={16} />, onZoomOut, "Zoom Out")}
      <button
        type="button"
        onClick={onZoomToFit}
        title="Zoom to fit all frames"
        style={{
          width: 36, height: 24,
          display: "flex", alignItems: "center", justifyContent: "center",
          borderRadius: 6, cursor: "pointer",
          background: "transparent", border: "1px solid transparent",
          color: "var(--text-muted, #7a7668)", fontSize: 10,
          fontFamily: "SF Mono, monospace",
        }}
      >
        {Math.round(zoom * 100)}%
      </button>
      {actionBtn(<IconZoomIn size={16} />, onZoomIn, "Zoom In")}
      {actionBtn(<IconMaximize size={14} />, onZoomToFit, "Fit All")}
    </div>
  );
}
