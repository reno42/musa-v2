import { useState, useRef, useEffect, useCallback } from "react";
import type { HtmlToolName } from "./InfiniteHtmlCanvas";
import {
  IconPointer, IconHand, IconRectangle, IconCircleOutline, IconType, IconPen,
  IconFrame,
  IconChevronDown, IconTriangle, IconStar, IconHexagon,
  IconIntersect, IconShapes,
  IconPenPlus, IconPenMinus, IconPenEdit, IconPencil,
  IconTextPath,
} from "../shared/icons";

interface Props {
  tool: HtmlToolName;
  onToolChange: (t: HtmlToolName) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  multiSelectCount?: number;
  onPathfinder?: (op: "union" | "subtract" | "intersect" | "exclude") => void;
  onSvgImport?: () => void;
  onIconPicker?: (anchorRect: DOMRect) => void;
  onGroup?: () => void;
  onUngroup?: () => void;
  canGroup?: boolean;
  canUngroup?: boolean;
}

const SHAPE_TOOLS: { key: HtmlToolName; icon: React.ReactNode; shortcut: string; title: string }[] = [
  { key: "rect",     icon: <IconRectangle size={16} />,    shortcut: "R", title: "Rectangle" },
  { key: "circle",   icon: <IconCircleOutline size={16} />, shortcut: "O", title: "Circle" },
  { key: "triangle", icon: <IconTriangle size={16} />,     shortcut: "G", title: "Triangle" },
  { key: "star",     icon: <IconStar size={16} />,         shortcut: "S", title: "Star" },
  { key: "polygon",  icon: <IconHexagon size={16} />,      shortcut: "N", title: "Polygon (Shift for sides)" },
];

const PEN_TOOLS: { key: HtmlToolName; icon: React.ReactNode; shortcut: string; title: string }[] = [
  { key: "pen",       icon: <IconPen size={16} />,       shortcut: "P", title: "Pen — click to add points, drag for bezier" },
  { key: "pen-plus",  icon: <IconPenPlus size={16} />,   shortcut: "+", title: "Pen + — click a segment to add a point" },
  { key: "pen-minus", icon: <IconPenMinus size={16} />,  shortcut: "−", title: "Pen − — click a point to delete it" },
  { key: "pen-edit",  icon: <IconPenEdit size={16} />,   shortcut: "C", title: "Convert — click a point to show bezier handles" },
  { key: "pencil",    icon: <IconPencil size={16} />,    shortcut: "B", title: "Pencil — freehand draw (hold and drag)" },
];

const TEXT_TOOLS: { key: HtmlToolName; icon: React.ReactNode; shortcut: string; title: string }[] = [
  { key: "text",       icon: <IconType size={16} />,        shortcut: "T", title: "Text — click to place a text block" },
  { key: "text-path",  icon: <IconTextPath size={16} />,    shortcut: "⇧T", title: "Text on Path — click a path to write along its curve" },
];

const shortcutLabel: React.CSSProperties = {
  position: "absolute",
  bottom: 1,
  right: 2,
  fontSize: 8,
  fontFamily: "SF Mono, monospace",
  color: "var(--text-muted, #7a7668)",
  opacity: 0.6,
};

export function FloatingToolbar({
  tool, onToolChange,
  canUndo, canRedo, onUndo, onRedo,
  multiSelectCount, onPathfinder, onSvgImport,
  onIconPicker,
  onGroup, onUngroup, canGroup, canUngroup,
}: Props) {
  const [showPathfinder, setShowPathfinder] = useState(false);
  const [openFlyout, setOpenFlyout] = useState<"shapes" | "pen" | "text" | null>(null);
  const [defaultShape, setDefaultShape] = useState<string>("rect");
  const [defaultPen, setDefaultPen] = useState<string>("pen");
  const [defaultText, setDefaultText] = useState<string>("text");

  const rootRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);

  // Close everything on outside click / touch
  useEffect(() => {
    const handler = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (rootRef.current && !rootRef.current.contains(t)) {
        setOpenFlyout(null);
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler, { passive: true });
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, []);

  // Cleanup timer on unmount
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  // ── Desktop hover helpers (200ms close delay) ──
  const cancelClose = useCallback(() => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = undefined; }
  }, []);

  const hoverOpen = useCallback((which: "shapes" | "pen" | "text") => {
    cancelClose();
    setOpenFlyout(which);
  }, [cancelClose]);

  const hoverScheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpenFlyout(null), 200);
  }, [cancelClose]);

  // Chevron click — explicit toggle (works on all devices)
  const chevronToggle = useCallback((which: "shapes" | "pen" | "text") => {
    setOpenFlyout(prev => prev === which ? null : which);
  }, []);

  // Which shape icon to show on the main button (last selected or default)
  const activeShapeKey = SHAPE_TOOLS.find(s => s.key === tool)?.key;
  const displayShapeKey = activeShapeKey || (defaultShape as HtmlToolName);
  const displayShape = SHAPE_TOOLS.find(s => s.key === displayShapeKey) || SHAPE_TOOLS[0];

  // Which pen icon to show on the main button (last selected or default)
  const activePenKey = PEN_TOOLS.find(p => p.key === tool)?.key;
  const displayPenKey = activePenKey || (defaultPen as HtmlToolName);
  const displayPen = PEN_TOOLS.find(p => p.key === displayPenKey) || PEN_TOOLS[0];

  // Which text icon to show on the main button (last selected or default)
  const activeTextKey = TEXT_TOOLS.find(tx => tx.key === tool)?.key;
  const displayTextKey = activeTextKey || (defaultText as HtmlToolName);
  const displayText = TEXT_TOOLS.find(tx => tx.key === displayTextKey) || TEXT_TOOLS[0];

  // ── Standalone tool button ──
  const toolBtn = (name: HtmlToolName, icon: React.ReactNode, shortcut: string, title: string) => (
    <button
      type="button"
      onClick={() => onToolChange(name)}
      title={`${title} (${shortcut})`}
      style={{
        width: 46, height: 36,
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
      <span style={shortcutLabel}>{shortcut}</span>
    </button>
  );

  // ── Action button (zoom, undo, etc.) ──
  const actionBtn = (icon: React.ReactNode, onClick: () => void, title: string, disabled?: boolean) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        width: 46, height: 36,
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

  // ── Action button with a small shortcut label (matches the tool buttons) ──
  const labeledActionBtn = (icon: React.ReactNode, shortcut: string, title: string, onClick: () => void, disabled?: boolean) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={`${title} (${shortcut})`}
      style={{
        width: 46, height: 36,
        display: "flex", alignItems: "center", justifyContent: "center",
        borderRadius: 8, cursor: disabled ? "not-allowed" : "pointer",
        background: "transparent", border: "1px solid transparent",
        color: disabled ? "rgba(122,118,104,0.3)" : "var(--text-muted, #7a7668)",
        transition: "all 0.15s ease", opacity: disabled ? 0.4 : 1,
        position: "relative",
      }}
    >
      {icon}
      <span style={shortcutLabel}>{shortcut}</span>
    </button>
  );

  const divider = (
    <div style={{ width: 28, height: 1, background: "var(--border-color, rgba(255,255,255,0.06))", margin: "4px auto" }} />
  );

  // ── Flyout panel (vertical column to the right of the button) ──
  const flyoutStyle: React.CSSProperties = {
    position: "absolute",
    left: "100%",
    marginLeft: 6,
    top: 0,
    zIndex: 30,
    background: "var(--glass-bg, rgba(12,12,12,0.85))",
    backdropFilter: "blur(20px) saturate(180%)",
    WebkitBackdropFilter: "blur(20px) saturate(180%)",
    border: "1px solid var(--glass-border, rgba(255,255,255,0.06))",
    borderRadius: 10,
    padding: 4,
    display: "flex",
    flexDirection: "column",
    gap: 2,
    boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
  };

  // ── Split button (main + chevron) ──
  const SplitButton = ({
    which,
    mainIcon,
    mainShortcut,
    mainTitle,
    onMainClick,
    isActive,
    children,
  }: {
    which: "shapes" | "pen" | "text";
    mainIcon: React.ReactNode;
    mainShortcut: string | null;
    mainTitle: string;
    onMainClick: () => void;
    isActive: boolean;
    children?: React.ReactNode;
  }) => {
    const isOpen = openFlyout === which;
    return (
      <div
        style={{ position: "relative" }}
        onMouseEnter={() => hoverOpen(which)}
        onMouseLeave={hoverScheduleClose}
      >
        {/* Split button row */}
        <div style={{
          display: "flex",
          borderRadius: 8,
          background: isOpen ? "var(--accent-dim, rgba(200,184,152,0.06))" : "transparent",
        }}>
          {/* Main button area */}
          <button
            type="button"
            onClick={onMainClick}
            title={mainTitle}
            style={{
              width: 32, height: 36,
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer",
              background: isActive ? "var(--accent-dim, rgba(200,184,152,0.15))" : "transparent",
              border: isActive ? "1px solid var(--accent, #c8b898)" : "1px solid transparent",
              borderRadius: "8px 0 0 8px",
              color: isActive ? "var(--accent, #c8b898)" : "var(--text-muted, #7a7668)",
              transition: "all 0.15s ease",
              position: "relative",
            }}
          >
            {mainIcon}
            {mainShortcut && <span style={shortcutLabel}>{mainShortcut}</span>}
          </button>

          {/* Chevron toggle area */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); chevronToggle(which); }}
            title="More options"
            aria-label="More options"
            aria-expanded={isOpen}
            style={{
              width: 14, height: 36,
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer",
              background: "transparent",
              border: "1px solid transparent",
              borderLeft: "1px solid var(--border-color, rgba(255,255,255,0.06))",
              borderRadius: "0 8px 8px 0",
              color: "var(--text-muted, #7a7668)",
              transition: "all 0.15s ease",
            }}
          >
            <IconChevronDown size={9} style={{
              transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)",
              transition: "transform 0.15s ease",
              opacity: isOpen ? 0.9 : 0.45,
            }} />
          </button>
        </div>

        {/* Flyout panel (child of positioned container) */}
        {isOpen && children && (
          <div style={flyoutStyle}>{children}</div>
        )}
      </div>
    );
  };

  // Flyout item button
  const flyoutItem = (active: boolean): React.CSSProperties => ({
    width: 36, height: 36,
    display: "flex", alignItems: "center", justifyContent: "center",
    borderRadius: 6, cursor: "pointer",
    background: active ? "var(--accent-dim, rgba(200,184,152,0.15))" : "transparent",
    border: active ? "1px solid var(--accent, #c8b898)" : "1px solid transparent",
    color: active ? "var(--accent, #c8b898)" : "var(--text-muted, #7a7668)",
    transition: "all 0.15s ease",
    position: "relative",
  });

  return (
    <div ref={rootRef} style={{
      background: "var(--glass-bg, rgba(12,12,12,0.65))",
      backdropFilter: "blur(20px) saturate(180%)",
      WebkitBackdropFilter: "blur(20px) saturate(180%)",
      border: "1px solid var(--glass-border, rgba(255,255,255,0.06))",
      borderRadius: 14,
      boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      padding: "8px 6px",
      display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
    }}>
      {/* ── Selection tools ── */}
      {toolBtn("select", <IconPointer size={16} />, "V", "Select")}
      {toolBtn("hand", <IconHand size={16} />, "H", "Hand — drag to pan")}
      {toolBtn("frame", <IconFrame size={16} />, "F", "Frame — click for 100×100, drag for custom size")}

      {divider}

      {/* ── Shape split button + flyout ── */}
      <SplitButton
        which="shapes"
        mainIcon={displayShape.icon}
        mainShortcut={displayShape.shortcut}
        mainTitle={`${displayShape.title} (${displayShape.shortcut})`}
        onMainClick={() => onToolChange(displayShape.key)}
        isActive={!!activeShapeKey}
      >
        {SHAPE_TOOLS.map(item => (
          <button
            key={item.key}
            type="button"
            onClick={() => {
              onToolChange(item.key);
              setDefaultShape(item.key);
              setOpenFlyout(null);
            }}
            title={`${item.title} (${item.shortcut})`}
            style={flyoutItem(tool === item.key)}
            onMouseEnter={(e) => {
              if (tool !== item.key) (e.currentTarget as HTMLButtonElement).style.background = "var(--accent-dim, rgba(200,184,152,0.08))";
            }}
            onMouseLeave={(e) => {
              if (tool !== item.key) (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            }}
          >
            {item.icon}
            <span style={shortcutLabel}>{item.shortcut}</span>
          </button>
        ))}
      </SplitButton>

      {/* ── Text split button + flyout ── */}
      <SplitButton
        which="text"
        mainIcon={displayText.icon}
        mainShortcut={displayText.shortcut}
        mainTitle={displayText.title}
        onMainClick={() => onToolChange(displayText.key)}
        isActive={!!activeTextKey}
      >
        {TEXT_TOOLS.map(item => (
          <button
            key={item.key}
            type="button"
            onClick={() => {
              onToolChange(item.key);
              setDefaultText(item.key);
              setOpenFlyout(null);
            }}
            title={item.title}
            style={flyoutItem(tool === item.key)}
            onMouseEnter={(e) => {
              if (tool !== item.key) (e.currentTarget as HTMLButtonElement).style.background = "var(--accent-dim, rgba(200,184,152,0.08))";
            }}
            onMouseLeave={(e) => {
              if (tool !== item.key) (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            }}
          >
            {item.icon}
            <span style={shortcutLabel}>{item.shortcut}</span>
          </button>
        ))}
      </SplitButton>

      {/* ── Pen split button + flyout ── */}
      <SplitButton
        which="pen"
        mainIcon={displayPen.icon}
        mainShortcut={displayPen.shortcut}
        mainTitle={displayPen.title}
        onMainClick={() => onToolChange(displayPen.key)}
        isActive={!!activePenKey}
      >
        {PEN_TOOLS.map(item => (
          <button
            key={item.key}
            type="button"
            onClick={() => {
              onToolChange(item.key);
              setDefaultPen(item.key);
              setOpenFlyout(null);
            }}
            title={item.title}
            style={flyoutItem(tool === item.key)}
            onMouseEnter={(e) => {
              if (tool !== item.key) (e.currentTarget as HTMLButtonElement).style.background = "var(--accent-dim, rgba(200,184,152,0.08))";
            }}
            onMouseLeave={(e) => {
              if (tool !== item.key) (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            }}
          >
            {item.icon}
            <span style={shortcutLabel}>{item.shortcut}</span>
          </button>
        ))}
      </SplitButton>

      {divider}

      {/* ── Pathfinder ── */}
      {onPathfinder && (
        <>
          <div style={{ position: "relative" }}>
            <button
              type="button"
              title={`Pathfinder — boolean ops on 2+ selected shapes (${(multiSelectCount || 0)} selected)`}
              disabled={(multiSelectCount || 0) < 2}
              onClick={() => setShowPathfinder(!showPathfinder)}
              style={{
                width: 46, height: 36,
                display: "flex", alignItems: "center", justifyContent: "center",
                borderRadius: 8,
                cursor: (multiSelectCount || 0) < 2 ? "not-allowed" : "pointer",
                background: showPathfinder ? "var(--accent-dim, rgba(200,184,152,0.15))" : "transparent",
                border: showPathfinder ? "1px solid var(--accent, #c8b898)" : "1px solid transparent",
                color: (multiSelectCount || 0) < 2 ? "rgba(122,118,104,0.3)" : (showPathfinder ? "var(--accent, #c8b898)" : "var(--text-muted, #7a7668)"),
                opacity: (multiSelectCount || 0) < 2 ? 0.4 : 1,
                transition: "all 0.15s ease",
              }}
            >
              <IconIntersect size={16} />
            </button>
            {showPathfinder && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 29 }} onClick={() => setShowPathfinder(false)} />
                <div style={{ ...flyoutStyle, minWidth: 150, padding: 6, gap: 0 }}>
                  <div style={{ fontSize: 10, color: "#7a7668", padding: "2px 8px 4px", textTransform: "uppercase", letterSpacing: 1 }}>Pathfinder</div>
                  {([
                    { op: "union", label: "Union", icon: "∪" },
                    { op: "subtract", label: "Subtract", icon: "−" },
                    { op: "intersect", label: "Intersect", icon: "∩" },
                    { op: "exclude", label: "Exclude", icon: "⊕" },
                  ] as const).map(({ op, label, icon }) => (
                    <button
                      key={op}
                      type="button"
                      disabled={(multiSelectCount || 0) < 2}
                      onClick={() => { onPathfinder(op); setShowPathfinder(false); }}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        width: "100%", padding: "5px 10px",
                        background: "transparent", border: "1px solid transparent",
                        borderRadius: 6, color: "var(--text-main, #c4c0b4)",
                        cursor: (multiSelectCount || 0) >= 2 ? "pointer" : "not-allowed",
                        fontSize: 12, fontFamily: "inherit", opacity: (multiSelectCount || 0) >= 2 ? 1 : 0.4,
                        transition: "all 0.1s",
                      }}
                      onMouseEnter={(e) => { if ((multiSelectCount || 0) >= 2) (e.currentTarget as HTMLButtonElement).style.background = "var(--accent-dim, rgba(200,184,152,0.1))"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                    >
                      <span style={{ width: 18, textAlign: "center", fontSize: 14, fontWeight: 600 }}>{icon}</span>
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {divider}
        </>
      )}

      {/* ── SVG Import ── */}
      {onSvgImport && (
        <>
          {actionBtn(
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/></svg>,
            onSvgImport, "Import SVG",
          )}
          {divider}
        </>
      )}

      {/* ── Group / Ungroup ── */}
      {(onGroup || onUngroup) && <>
        {onGroup && labeledActionBtn(
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="4" width="7" height="7" rx="1" /><rect x="13" y="13" width="7" height="7" rx="1" />
            <path d="M4 15v3a2 2 0 0 0 2 2h3M15 4h3a2 2 0 0 1 2 2v3" strokeDasharray="2 2" />
          </svg>,
          "⌘G", "Group", () => onGroup(), !canGroup,
        )}
        {onUngroup && labeledActionBtn(
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="6" height="6" rx="1" /><rect x="15" y="15" width="6" height="6" rx="1" />
            <path d="M15 6h3M18 6v3M6 15v3M6 18h3" strokeDasharray="2 2" />
          </svg>,
          "⇧⌘G", "Ungroup", () => onUngroup(), !canUngroup,
        )}
        {divider}
      </>}

      {/* ── Undo / Redo ── */}
      {actionBtn(
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12.5 8c-2.65 0-5.05 1.04-6.83 2.73L3 8v9h9l-3.62-3.62C9.89 12.02 11.12 11.5 12.5 11.5c2.28 0 4.22 1.52 4.84 3.58l2.87-.78C19.36 11.38 16.21 8 12.5 8z"/></svg>,
        onUndo, "Undo (Ctrl+Z)", !canUndo,
      )}
      {actionBtn(
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.16 0-7.74 2.42-9.44 5.93l2.57 1.11C5.9 12.55 8.47 11 11.5 11c2.09 0 3.99.75 5.47 1.98L13 17h9V8l-3.6 2.6z"/></svg>,
        onRedo, "Redo (Ctrl+Shift+Z)", !canRedo,
      )}

      {onIconPicker && <>
        {divider}
        {/* ── Icons Toggle ── */}
        <button
          type="button"
          onClick={e => onIconPicker(e.currentTarget.getBoundingClientRect())}
          title="Icons — click to open, drag onto the canvas to place"
          style={{
            width: 46, height: 36,
            display: "flex", alignItems: "center", justifyContent: "center",
            borderRadius: 8, cursor: "pointer",
            background: "transparent", border: "1px solid transparent",
            color: "var(--text-muted, #7a7668)",
            transition: "all 0.15s ease",
          }}
        >
          <IconShapes size={16} />
        </button>
      </>}

    </div>
  );
}
