import type { Dispatch } from "react";
import type { ToolName } from "../../hooks/useCanvas";
import type { BooleanOperation } from "@futuraria/shared";
import type { DropdownAction } from "../../hooks/useDropdowns";
import { AlignBtn, PopupBtn } from "./ToolbarButtons";

type AlignDirection = "left" | "center-h" | "right" | "top" | "center-v" | "bottom";

type DropdownDispatch = Dispatch<DropdownAction>;

// ─── Shapes Dropdown ──────────────────────────────────────────

interface ShapesDropdownProps {
  tool: ToolName;
  onToolChange: (t: ToolName) => void;
  open: boolean;
  dropdownRef: React.RefObject<HTMLDivElement>;
  dispatch: DropdownDispatch;
}

export function ShapesDropdown({ tool, onToolChange, open, dropdownRef, dispatch }: ShapesDropdownProps) {
  const pick = (t: ToolName) => { onToolChange(t); dispatch({ type: "CLOSE_SHAPES" }); };

  const shapeTools = ["rect", "ellipse", "line", "triangle", "star", "polygon"] as const;
  const isActive = (shapeTools as readonly string[]).includes(tool);

  return (
    <div className="align-dropdown-wrapper" ref={dropdownRef}>
      <button
        type="button"
        className={`tool-btn${isActive ? " active" : ""} has-submenu`}
        onClick={() => dispatch({ type: "TOGGLE_SHAPES" })}
        title="Shapes" aria-label="Shapes"
      >
        <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" /></svg>
        <span className="corner-marker"><svg viewBox="0 0 6 6"><path d="M0 6L6 6L6 0Z" fill="currentColor" opacity="0.6" /></svg></span>
      </button>

      {open && (
        <div className="align-dropdown" style={{ top: -4 }}>
          <div className="align-dropdown-section">
            <span className="align-dropdown-label">Shapes</span>
            <div className="align-dropdown-row" style={{ flexDirection: "column", gap: 3 }}>
              <PopupBtn icon={<rect x="3" y="3" width="18" height="18" rx="2" />} label="Rectangle" shortcut="R" active={tool === "rect"} onClick={() => pick("rect")} />
              <PopupBtn icon={<ellipse cx="12" cy="12" rx="10" ry="10" />} label="Ellipse" shortcut="O" active={tool === "ellipse"} onClick={() => pick("ellipse")} />
              <PopupBtn icon={<line x1="5" y1="19" x2="19" y2="5" stroke="currentColor" strokeWidth="2" />} label="Line" shortcut="L" active={tool === "line"} onClick={() => pick("line")} />
              <PopupBtn icon={<path d="M12 2L3 22h18L12 2z" />} label="Triangle" active={tool === "triangle"} onClick={() => pick("triangle")} />
              <PopupBtn icon={<path d="M12 2l3.1 9.5h9.9l-8 5.8 3 9.7-8-5.8-8 5.8 3-9.7-8-5.8h9.9z" />} label="Star" active={tool === "star"} onClick={() => pick("star")} />
              <PopupBtn icon={<path d="M12 2l4 4 4-4 4 4-4 4 4 4-4 4-4-4-4 4-4-4 4-4-4-4z" />} label="Polygon" active={tool === "polygon"} onClick={() => pick("polygon")} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Draw Dropdown ────────────────────────────────────────────

interface DrawDropdownProps {
  tool: ToolName;
  onToolChange: (t: ToolName) => void;
  open: boolean;
  dropdownRef: React.RefObject<HTMLDivElement>;
  dispatch: DropdownDispatch;
}

export function DrawDropdown({ tool, onToolChange, open, dropdownRef, dispatch }: DrawDropdownProps) {
  const pick = (t: ToolName) => { onToolChange(t); dispatch({ type: "CLOSE_DRAW" }); };

  const isActive = ["pencil", "pen"].includes(tool);

  return (
    <div className="align-dropdown-wrapper" ref={dropdownRef}>
      <button
        type="button"
        className={`tool-btn${isActive ? " active" : ""} has-submenu`}
        onClick={() => dispatch({ type: "TOGGLE_DRAW" })}
        title="Draw Tools" aria-label="Draw Tools"
      >
        <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg>
        <span className="corner-marker"><svg viewBox="0 0 6 6"><path d="M0 6L6 6L6 0Z" fill="currentColor" opacity="0.6" /></svg></span>
      </button>

      {open && (
        <div className="align-dropdown" style={{ top: -4 }}>
          <div className="align-dropdown-section">
            <span className="align-dropdown-label">Draw</span>
            <div className="align-dropdown-row" style={{ flexDirection: "column", gap: 3 }}>
              <PopupBtn
                icon={<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />}
                label="Pencil" shortcut="P"
                active={tool === "pencil"}
                onClick={() => pick("pencil")}
              />
              <PopupBtn
                icon={<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15v-4H7l5-7v4h4l-5 7z" />}
                label="Pen / Bezier" shortcut="B"
                active={tool === "pen"}
                onClick={() => pick("pen")}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Align Dropdown ───────────────────────────────────────────

interface AlignDropdownProps {
  onAlign: (direction: AlignDirection) => void;
  onDistribute: (direction: "horizontal" | "vertical") => void;
  open: boolean;
  enabled: boolean;
  dropdownRef: React.RefObject<HTMLDivElement>;
  dispatch: DropdownDispatch;
}

export function AlignDropdown({ onAlign, onDistribute, open, enabled, dropdownRef, dispatch }: AlignDropdownProps) {
  const close = () => dispatch({ type: "CLOSE_ALIGN" });

  return (
    <div className="align-dropdown-wrapper" ref={dropdownRef}>
      <button
        type="button"
        className={`tool-btn has-submenu${enabled ? "" : " disabled"}`}
        onClick={() => enabled && dispatch({ type: "TOGGLE_ALIGN" })}
        title="Align & Distribute" aria-label="Align and Distribute"
        disabled={!enabled}
      >
        <svg viewBox="0 0 24 24">
          <path d="M4 4h4v16H4V4zm6 4h4v12h-4V8zm6 2h4v10h-4V10zM2 2v20h20V2H2z" opacity="0.3" />
          <path d="M7 4v16M13 8v12M19 10v10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
        </svg>
        <span className="corner-marker"><svg viewBox="0 0 6 6"><path d="M0 6L6 6L6 0Z" fill="currentColor" opacity="0.6" /></svg></span>
      </button>

      {open && (
        <div className="align-dropdown">
          <div className="align-dropdown-section">
            <span className="align-dropdown-label">Align</span>
            <div className="align-dropdown-grid">
              <AlignBtn icon={<path d="M3 3v18M6 6h10v4H6zM6 14h14v4H6z" />} title="Align Left" onClick={() => { onAlign("left"); close(); }} />
              <AlignBtn icon={<><path d="M12 3v18" /><rect x="5" y="6" width="14" height="4" rx="1" /><rect x="7" y="14" width="10" height="4" rx="1" /></>} title="Align Center (H)" onClick={() => { onAlign("center-h"); close(); }} />
              <AlignBtn icon={<path d="M21 3v18M8 6h10v4H8zM4 14h14v4H4z" />} title="Align Right" onClick={() => { onAlign("right"); close(); }} />
              <AlignBtn icon={<path d="M3 3h18M6 6v10h4V6zM14 6v14h4V6z" />} title="Align Top" onClick={() => { onAlign("top"); close(); }} />
              <AlignBtn icon={<><path d="M3 12h18" /><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="7" width="4" height="10" rx="1" /></>} title="Align Middle (V)" onClick={() => { onAlign("center-v"); close(); }} />
              <AlignBtn icon={<path d="M3 21h18M6 8v10h4V8zM14 4v14h4V4z" />} title="Align Bottom" onClick={() => { onAlign("bottom"); close(); }} />
            </div>
          </div>
          <div className="align-dropdown-divider" />
          <div className="align-dropdown-section">
            <span className="align-dropdown-label">Distribute</span>
            <div className="align-dropdown-row">
              <AlignBtn icon={<><rect x="2" y="8" width="4" height="8" rx="1" /><rect x="10" y="10" width="4" height="4" rx="1" /><rect x="18" y="8" width="4" height="8" rx="1" /></>} title="Distribute Horizontally" onClick={() => { onDistribute("horizontal"); close(); }} />
              <AlignBtn icon={<><rect x="8" y="2" width="8" height="4" rx="1" /><rect x="10" y="10" width="4" height="4" rx="1" /><rect x="8" y="18" width="8" height="4" rx="1" /></>} title="Distribute Vertically" onClick={() => { onDistribute("vertical"); close(); }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Boolean Dropdown ─────────────────────────────────────────

interface BooleanDropdownProps {
  onBooleanOp: (op: BooleanOperation) => void;
  open: boolean;
  enabled: boolean;
  dropdownRef: React.RefObject<HTMLDivElement>;
  dispatch: DropdownDispatch;
}

export function BooleanDropdown({ onBooleanOp, open, enabled, dropdownRef, dispatch }: BooleanDropdownProps) {
  const close = () => dispatch({ type: "CLOSE_BOOL" });

  return (
    <div className="align-dropdown-wrapper" ref={dropdownRef}>
      <button
        type="button"
        className={`tool-btn has-submenu${enabled ? "" : " disabled"}`}
        onClick={() => enabled && dispatch({ type: "TOGGLE_BOOL" })}
        title="Boolean Operations" aria-label="Boolean Operations"
        disabled={!enabled}
      >
        <svg viewBox="0 0 24 24">
          <circle cx="9" cy="10" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="15" cy="14" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <span className="corner-marker"><svg viewBox="0 0 6 6"><path d="M0 6L6 6L6 0Z" fill="currentColor" opacity="0.6" /></svg></span>
      </button>

      {open && (
        <div className="align-dropdown">
          <div className="align-dropdown-section">
            <span className="align-dropdown-label">Boolean</span>
            <div className="align-dropdown-grid">
              <AlignBtn icon={<><circle cx="9" cy="10" r="6" fill="currentColor" opacity="0.4" /><circle cx="15" cy="14" r="6" fill="currentColor" opacity="0.4" /></>} title="Union" onClick={() => { onBooleanOp("union"); close(); }} />
              <AlignBtn icon={<><circle cx="9" cy="10" r="6" fill="currentColor" opacity="0.4" /><circle cx="15" cy="14" r="6" fill="currentColor" opacity="0.15" /><circle cx="15" cy="14" r="6" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" /></>} title="Subtract" onClick={() => { onBooleanOp("subtract"); close(); }} />
              <AlignBtn icon={<><circle cx="9" cy="10" r="6" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.4" /><circle cx="15" cy="14" r="6" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.4" /><ellipse cx="12" cy="12" rx="3.5" ry="5" fill="currentColor" opacity="0.4" /></>} title="Intersect" onClick={() => { onBooleanOp("intersect"); close(); }} />
              <AlignBtn icon={<><circle cx="9" cy="10" r="6" fill="currentColor" opacity="0.3" /><circle cx="15" cy="14" r="6" fill="currentColor" opacity="0.3" /><ellipse cx="12" cy="12" rx="3.5" ry="5" fill="#1e1e2e" /></>} title="Exclude" onClick={() => { onBooleanOp("exclude"); close(); }} />
            </div>
          </div>
          <div className="align-dropdown-divider" />
          <div style={{ padding: "4px 8px", color: "#888", fontSize: 12 }}>Select 2+ shapes to combine</div>
        </div>
      )}
    </div>
  );
}
