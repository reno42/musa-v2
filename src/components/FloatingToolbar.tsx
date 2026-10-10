// Slim cursor-tool rail: only tools that change what a click does. Everything
// else lives where it already had a home — Undo/Redo/Group/Ungroup/Pathfinder
// in the canvas right-click menu plus their shortcuts (Ctrl/⌘+Z, +G, +Alt+U/S/I/E),
// Zoom and SVG import in the top bar, icon library inside the Shapes flyout.
import { useState, useRef, useEffect, useCallback } from "react";
import type { HtmlToolName } from "./InfiniteHtmlCanvas";
import {
  IconPointer, IconHand, IconRectangle, IconCircleOutline, IconType, IconPen,
  IconFrame,
  IconChevronDown, IconTriangle, IconStar, IconHexagon,
  IconShapes,
  IconPenPlus, IconPenMinus, IconPenEdit, IconPencil,
  IconTextPath,
  IconEyedropper, IconPaintBucket, IconGradient, IconSwap, IconLayers, IconEraser,
  IconWand,
} from "../shared/icons";

interface Props {
  tool: HtmlToolName;
  onToolChange: (t: HtmlToolName) => void;
  onIconPicker?: (anchorRect: DOMRect) => void;
  // Color tools
  foregroundColor?: string;
  backgroundColor?: string;
  onForegroundColorChange?: (color: string) => void;
  onBackgroundColorChange?: (color: string) => void;
  onSwapColors?: () => void;
  // Letras de atajo en la esquina de cada botón (V, H, R…) — ocultas por
  // default; Vista → "Letras de atajos" las enciende.
  showShortcuts?: boolean;
  // Layers panel
  showLayersPanel?: boolean;
  onToggleLayers?: () => void;
  // F4 Borrador: brush size (also [ ] keys in EditorV2)
  brushSize?: number;
  onBrushSizeChange?: (size: number) => void;
  // F2b CLIPSeg text mode: segment by description ("la persona")
  wandPrompt?: string;
  onWandPromptChange?: (value: string) => void;
  onWandPromptRun?: () => void;
}

const SHAPE_TOOLS: { key: HtmlToolName; icon: React.ReactNode; shortcut: string; title: string }[] = [
  { key: "rect",     icon: <IconRectangle size={16} />,    shortcut: "R", title: "Rectangle" },
  { key: "circle",   icon: <IconCircleOutline size={16} />, shortcut: "O", title: "Circle" },
  { key: "triangle", icon: <IconTriangle size={16} />,     shortcut: "G", title: "Triangle" },
  { key: "star",     icon: <IconStar size={16} />,         shortcut: "S", title: "Star" },
  { key: "polygon",  icon: <IconHexagon size={16} />,      shortcut: "N", title: "Polygon (Shift for sides)" },
  // REQ-044: herramienta línea (\), paridad Illustrator.
  { key: "line",     icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 13L13 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>, shortcut: "\\", title: "Line — drag to draw (Shift = 45°)" },
];

const PEN_TOOLS: { key: HtmlToolName; icon: React.ReactNode; shortcut: string; title: string }[] = [
  { key: "pen",       icon: <IconPen size={16} />,       shortcut: "P", title: "Pen — click to add points, drag for bezier" },
  { key: "pen-plus",  icon: <IconPenPlus size={16} />,   shortcut: "+", title: "Pen + — click a segment to add a point" },
  { key: "pen-minus", icon: <IconPenMinus size={16} />,  shortcut: "−", title: "Pen − — click a point to delete it" },
  { key: "pen-edit",  icon: <IconPenEdit size={16} />,   shortcut: "⇧C", title: "Convert — click a point to show bezier handles" },
  { key: "pencil",    icon: <IconPencil size={16} />,    shortcut: "B", title: "Pencil — freehand draw (hold and drag)" },
];

const TEXT_TOOLS: { key: HtmlToolName; icon: React.ReactNode; shortcut: string; title: string }[] = [
  { key: "text",       icon: <IconType size={16} />,        shortcut: "T", title: "Text — click to place a text block" },
  { key: "text-path",  icon: <IconTextPath size={16} />,    shortcut: "⇧T", title: "Text on Path — click a path to write along its curve" },
];

/**
 * The eyedropper is its own button, not a sibling in a flyout.
 *
 * It is a different verb: it READS a colour off the canvas, where the bucket
 * and the gradient WRITE one. Burying a picker one hover deep costs a click
 * every time you sample, and sampling is the frequent half of the pair.
 */
const EYEDROPPER_TOOL = {
  key: "eyedropper" as HtmlToolName,
  icon: <IconEyedropper size={16} />,
  shortcut: "I",
  title: "Cuentagotas — toma un color del lienzo (I)",
};

/** The fills. Gradient lives under the bucket because both paint the same
 *  property; only what they paint it with differs. */
const FILL_TOOLS: { key: HtmlToolName; icon: React.ReactNode; shortcut: string; title: string }[] = [
  { key: "paint-bucket", icon: <IconPaintBucket size={16} />,  shortcut: "K", title: "Bote de pintura — rellena con el color frontal" },
  { key: "gradient",     icon: <IconGradient size={16} />,     shortcut: "G", title: "Degradado — rellena con un degradado del frontal al de fondo" },
];

/** F4 Borrador. Its own button: over an <img> it paints non-destructive mask
 * strokes (Alt restores); over any other element it deletes it. */
const ERASER_TOOL = {
  key: "eraser" as HtmlToolName,
  icon: <IconEraser size={16} />,
  shortcut: "E",
  title: "Borrador — sobre imagen enmascara sin destruir (Alt restaura), sobre otros elementos borra (E)",
};

/** F2 Varita. Its own button: clicks on an <img> feed SAM click-to-segment
 *  prompts (Alt+click = exclude, double-click or Enter = apply, Esc = clear). */
const WAND_TOOL = {
  key: "wand" as HtmlToolName,
  icon: <IconWand size={16} />,
  shortcut: "W",
  title: "Varita — clic sobre una imagen la segmenta con SAM (Alt+clic excluye, doble clic o Enter aplica, Esc limpia)",
};

/** REQ-043 Tijeras y Cuchillo: los dos verbos de corte sobre paths. Botones
 *  propios (no variantes de la pluma) y sin atajo de teclado por ahora —
 *  las letras de la rail ya están tomadas por otras herramientas. */
const SCISSORS_TOOL = {
  key: "scissors" as HtmlToolName,
  icon: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="8.2" y1="7.9" x2="20" y2="19" />
      <line x1="8.2" y1="16.1" x2="20" y2="5" />
      <line x1="12.5" y1="12.9" x2="14.5" y2="11.1" />
    </svg>
  ),
  shortcut: "",
  title: "Tijeras — clic sobre un path para abrirlo por ese punto",
};

const KNIFE_TOOL = {
  key: "knife" as HtmlToolName,
  icon: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 21 L13.5 10.5" />
      <path d="M13.5 10.5 L19 3.5 C20.6 4.9 20.8 7.3 19.5 9 L15.2 14.6 Z" />
    </svg>
  ),
  shortcut: "",
  title: "Cuchillo — arrastra una línea para rebanar las formas que cruce",
};

const shortcutLabel: React.CSSProperties = {
  position: "absolute",
  bottom: 0,
  right: 2,
  fontSize: 10,
  fontFamily: "SF Mono, monospace",
  color: "var(--text-muted, #7a7668)",
  opacity: 0.6,
};

export function FloatingToolbar({
  tool, onToolChange, showShortcuts = false,
  onIconPicker,
  foregroundColor = "#000000", backgroundColor = "#ffffff",
  onForegroundColorChange, onBackgroundColorChange, onSwapColors,
  showLayersPanel, onToggleLayers,
  brushSize = 24, onBrushSizeChange,
  wandPrompt = "", onWandPromptChange, onWandPromptRun,
}: Props) {
  const [openFlyout, setOpenFlyout] = useState<"shapes" | "pen" | "text" | "colors" | null>(null);
  const [defaultShape, setDefaultShape] = useState<string>("rect");
  const [defaultPen, setDefaultPen] = useState<string>("pen");
  const [defaultText, setDefaultText] = useState<string>("text");
  const [defaultColor, setDefaultColor] = useState<string>("paint-bucket");

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

  const hoverOpen = useCallback((which: "shapes" | "pen" | "text" | "colors") => {
    cancelClose();
    setOpenFlyout(which);
  }, [cancelClose]);

  const hoverScheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpenFlyout(null), 200);
  }, [cancelClose]);

  // Chevron click — explicit toggle (works on all devices)
  const chevronToggle = useCallback((which: "shapes" | "pen" | "text" | "colors") => {
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

  // Which color tool icon to show on the main button
  const activeFillKey = FILL_TOOLS.find(c => c.key === tool)?.key;
  const displayColorKey = activeFillKey || (defaultColor as HtmlToolName);
  const displayFill = FILL_TOOLS.find(c => c.key === displayColorKey) || FILL_TOOLS[0];

  // Las letras de atajo comparten un solo estilo; ocultas por default
  // (Vista → "Letras de atajos") para no ensuciar cada botón de la rail.
  const shortcutBadge = showShortcuts ? shortcutLabel : { ...shortcutLabel, display: "none" };

  // ── Standalone tool button ──
  const toolBtn = (name: HtmlToolName, icon: React.ReactNode, shortcut: string, title: string) => (
    <button
      type="button"
      onClick={() => onToolChange(name)}
      title={shortcut ? `${title} (${shortcut})` : title}
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
      <span style={shortcutBadge}>{shortcut}</span>
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
    which: "shapes" | "pen" | "text" | "colors";
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
            {mainShortcut && <span style={shortcutBadge}>{mainShortcut}</span>}
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
            <span style={shortcutBadge}>{item.shortcut}</span>
          </button>
        ))}
        {/* Icon library rides with the shapes: both INSERT vector artwork.
           Keeps the rail short without burying the picker deeper than one
           click (the flyout is already open for shapes anyway). */}
        {onIconPicker && (
          <>
            <div style={{ width: "100%", height: 1, background: "var(--border-color, rgba(255,255,255,0.06))", margin: "3px 0" }} />
            <button
              type="button"
              onClick={(e) => { onIconPicker(e.currentTarget.getBoundingClientRect()); setOpenFlyout(null); }}
              title="Biblioteca de iconos — clic para abrir, arrastra un icono al lienzo"
              style={{ ...flyoutItem(false), width: "100%", justifyContent: "flex-start", padding: "0 8px", gap: 8 }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--accent-dim, rgba(200,184,152,0.08))"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
            >
              <IconShapes size={14} />
              <span style={{ fontSize: 11, color: "var(--text-main, #c4c0b4)", whiteSpace: "nowrap" }}>Biblioteca de iconos</span>
            </button>
          </>
        )}
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
            <span style={shortcutBadge}>{item.shortcut}</span>
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
            <span style={shortcutBadge}>{item.shortcut}</span>
          </button>
        ))}
      </SplitButton>

      {/* ── Eraser: own button; size control appears while active ── */}
      <div style={{ position: "relative" }}>
        <button
          type="button"
          onClick={() => onToolChange(ERASER_TOOL.key)}
          title={ERASER_TOOL.title}
          style={{
            width: 46, height: 36,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", position: "relative", borderRadius: 8,
            background: tool === "eraser" ? "var(--accent-dim, rgba(200,184,152,0.15))" : "transparent",
            border: tool === "eraser" ? "1px solid var(--accent, #c8b898)" : "1px solid transparent",
            color: tool === "eraser" ? "var(--accent, #c8b898)" : "var(--text-muted, #7a7668)",
            transition: "all 0.15s ease",
          }}
        >
          {ERASER_TOOL.icon}
          <span style={shortcutBadge}>{ERASER_TOOL.shortcut}</span>
        </button>
        {tool === "eraser" && onBrushSizeChange && (
          <div style={{ ...flyoutStyle, minWidth: 150, padding: 8, gap: 4 }}>
            <div style={{ fontSize: 10, color: "#7a7668", textTransform: "uppercase", letterSpacing: 1 }}>Tamaño de brocha</div>
            <input
              type="range"
              min={4}
              max={120}
              step={2}
              value={brushSize}
              onChange={(e) => onBrushSizeChange(Number(e.target.value))}
              style={{ width: "100%", accentColor: "var(--accent, #c8b898)", cursor: "pointer" }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-muted, #7a7668)" }}>
              <span>{brushSize} px</span>
              <span>[ ]</span>
            </div>
            <div style={{ fontSize: 10, color: "#7a7668" }}>Arrastrar enmascara · Alt restaura</div>
          </div>
        )}
      </div>

      {/* ── Varita: own button; SAM click-to-segment over images ── */}
      <div style={{ position: "relative" }}>
        <button
          type="button"
          onClick={() => onToolChange(WAND_TOOL.key)}
          title={WAND_TOOL.title}
          style={{
            width: 46, height: 36,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", position: "relative", borderRadius: 8,
            background: tool === "wand" ? "var(--accent-dim, rgba(200,184,152,0.15))" : "transparent",
            border: tool === "wand" ? "1px solid var(--accent, #c8b898)" : "1px solid transparent",
            color: tool === "wand" ? "var(--accent, #c8b898)" : "var(--text-muted, #7a7668)",
            transition: "all 0.15s ease",
          }}
        >
          {WAND_TOOL.icon}
          <span style={shortcutBadge}>{WAND_TOOL.shortcut}</span>
        </button>
        {tool === "wand" && onWandPromptRun && (
          <div style={{ ...flyoutStyle, minWidth: 190, padding: 8, gap: 6 }}>
            <div style={{ fontSize: 10, color: "#7a7668", textTransform: "uppercase", letterSpacing: 1 }}>
              Segmentar por texto (CLIPSeg)
            </div>
            <input
              type="text"
              value={wandPrompt}
              onChange={(e) => onWandPromptChange?.(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && wandPrompt.trim()) {
                  e.preventDefault();
                  e.stopPropagation();
                  onWandPromptRun();
                }
                if (e.key === "Escape") e.stopPropagation();
              }}
              placeholder="la persona, el auto rojo…"
              style={{
                width: "100%",
                background: "var(--panel-bg, rgba(255,255,255,0.04))",
                border: "1px solid var(--glass-border, rgba(255,255,255,0.08))",
                borderRadius: 6,
                color: "var(--text, #e8e4d8)",
                fontSize: 12,
                padding: "6px 8px",
                outline: "none",
              }}
            />
            <button
              type="button"
              onClick={onWandPromptRun}
              disabled={!wandPrompt.trim()}
              style={{
                width: "100%",
                height: 26,
                borderRadius: 6,
                cursor: wandPrompt.trim() ? "pointer" : "default",
                background: wandPrompt.trim() ? "var(--accent-dim, rgba(200,184,152,0.15))" : "transparent",
                border: wandPrompt.trim() ? "1px solid var(--accent, #c8b898)" : "1px solid transparent",
                color: wandPrompt.trim() ? "var(--accent, #c8b898)" : "var(--text-muted, #7a7668)",
                fontSize: 11,
                transition: "all 0.15s ease",
              }}
            >
              Segmentar seleccionada
            </button>
            <div style={{ fontSize: 10, color: "#7a7668" }}>Usa la imagen seleccionada · Enter aplica</div>
          </div>
        )}
      </div>

      {/* ── REQ-043 Tijeras + Cuchillo: corte sobre paths ── */}
      {toolBtn(SCISSORS_TOOL.key, SCISSORS_TOOL.icon, SCISSORS_TOOL.shortcut, SCISSORS_TOOL.title)}
      {toolBtn(KNIFE_TOOL.key, KNIFE_TOOL.icon, KNIFE_TOOL.shortcut, KNIFE_TOOL.title)}

      {divider}

      {/* ── Eyedropper: on its own, because it reads rather than writes ── */}
      <button
        type="button"
        onClick={() => onToolChange(EYEDROPPER_TOOL.key)}
        title={EYEDROPPER_TOOL.title}
        style={{
          width: 46, height: 36,
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", position: "relative", borderRadius: 8,
          background: tool === "eyedropper" ? "var(--accent-dim, rgba(200,184,152,0.15))" : "transparent",
          border: tool === "eyedropper" ? "1px solid var(--accent, #c8b898)" : "1px solid transparent",
          color: tool === "eyedropper" ? "var(--accent, #c8b898)" : "var(--text-muted, #7a7668)",
          transition: "all 0.15s ease",
        }}
      >
        {EYEDROPPER_TOOL.icon}
        <span style={shortcutBadge}>{EYEDROPPER_TOOL.shortcut}</span>
      </button>

      {/* ── Fills: bucket, with gradient one level in ── */}
      <SplitButton
        which="colors"
        mainIcon={displayFill.icon}
        mainShortcut={displayFill.shortcut}
        mainTitle={displayFill.title}
        onMainClick={() => onToolChange(displayFill.key)}
        isActive={!!activeFillKey}
      >
        {FILL_TOOLS.map(item => (
          <button
            key={item.key}
            type="button"
            onClick={() => {
              onToolChange(item.key);
              setDefaultColor(item.key);
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
            <span style={shortcutBadge}>{item.shortcut}</span>
          </button>
        ))}
      </SplitButton>

      {divider}

      {/* ── Layers panel toggle ── */}
      {onToggleLayers && (
        <button
          type="button"
          onClick={onToggleLayers}
          title="Toggle Layers Panel"
          style={{
            width: 46, height: 36,
            display: "flex", alignItems: "center", justifyContent: "center",
            borderRadius: 8, cursor: "pointer",
            background: showLayersPanel ? "var(--accent-dim, rgba(200,184,152,0.15))" : "transparent",
            border: showLayersPanel ? "1px solid var(--accent, #c8b898)" : "1px solid transparent",
            color: showLayersPanel ? "var(--accent, #c8b898)" : "var(--text-muted, #7a7668)",
            transition: "all 0.15s ease",
          }}
        >
          <IconLayers size={16} />
        </button>
      )}

      {divider}
      {/* ── Foreground / background swatches (at the bottom — last tool in the stack) ── */}
      <div style={{ position: "relative", width: 46, height: 42, flexShrink: 0 }}>
        {/* Background sits back and down-right, so its whole face is visible. */}
        <input
          type="color"
          value={backgroundColor}
          onChange={e => onBackgroundColorChange?.(e.target.value)}
          title="Color de fondo — degradados y espacios que borras"
          aria-label="Color de fondo"
          style={{
            position: "absolute", right: 4, bottom: 2,
            width: 20, height: 20, padding: 0, cursor: "pointer",
            border: "1px solid var(--glass-border, rgba(255,255,255,0.25))",
            borderRadius: 3, background: backgroundColor,
          }}
        />
        {/* Foreground sits forward and up-left: the one that paints. */}
        <input
          type="color"
          value={foregroundColor}
          onChange={e => onForegroundColorChange?.(e.target.value)}
          title="Color frontal — pintar, rellenar y lo que toma el cuentagotas"
          aria-label="Color frontal"
          style={{
            position: "absolute", left: 2, top: 1,
            width: 22, height: 22, padding: 0, cursor: "pointer",
            border: "1px solid var(--glass-border, rgba(255,255,255,0.4))",
            borderRadius: 3, background: foregroundColor,
            boxShadow: "0 1px 4px rgba(0,0,0,0.45)",
          }}
        />
        <button
          type="button"
          onClick={onSwapColors}
          title="Intercambiar frontal y fondo (X)"
          aria-label="Intercambiar colores"
          style={{
            position: "absolute", right: 1, top: 0,
            width: 14, height: 14, padding: 0, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "transparent", border: "none",
            color: "var(--text-muted, #7a7668)",
          }}
        >
          <IconSwap size={11} />
        </button>
      </div>

    </div>
  );
}
