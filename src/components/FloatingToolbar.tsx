// Slim cursor-tool rail: only tools that change what a click does. Everything
// else lives where it already had a home — Undo/Redo/Group/Ungroup/Pathfinder
// in the canvas right-click menu plus their shortcuts (Ctrl/⌘+Z, +G, +Alt+U/S/I/E),
// Zoom and SVG import in the top bar, icon library inside the Shapes flyout.
import { useState, useRef, useEffect, useCallback } from "react";
import type { HtmlToolName } from "./InfiniteHtmlCanvas";
import {
  IconHand, IconChevronDown, IconTriangle, IconStar, IconHexagon,
  IconShapes, IconSwap, IconLayers,
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

type ToolDef = { key: HtmlToolName; icon: React.ReactNode; shortcut: string; title: string };

// ── Iconografía estilo Illustrator ──
// Réplica de los glifos de la barra de Illustrator (trazo 1.7, esquinas
// redondas, lienzo 24×24) para que la rail se lea igual que la de IA.
// La mano, triángulo, estrella, polígono, chevron, capas y swap siguen en
// ../shared/icons porque ya coinciden con el original.
const aiSvg = (children: React.ReactNode, filled = false) => (
  <svg width="16" height="16" viewBox="0 0 24 24"
    fill={filled ? "currentColor" : "none"} stroke="currentColor"
    strokeWidth={filled ? 0 : 1.7} strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true">{children}</svg>
);

// Grupo 1 (Illustrator): flecha de selección sólida.
const SELECT_TOOL: ToolDef = {
  key: "select",
  icon: aiSvg(<path d="M5.5 3 18.6 11.4 12.2 12.8 9 19.2Z" />, true),
  shortcut: "V",
  title: "Select",
};

// Grupo 2: varita mágica con destellos (conserva su panel SAM al activarla).
const WAND_TOOL: ToolDef = {
  key: "wand",
  icon: aiSvg(<>
    <path d="M4.5 19.5 11 13" />
    <path d="M15.5 3.5 16.8 7.2 20.5 8.5 16.8 9.8 15.5 13.5 14.2 9.8 10.5 8.5 14.2 7.2Z" fill="currentColor" stroke="none" />
    <path d="M19.9 14.9 20.5 16.5 22.1 17.1 20.5 17.7 19.9 19.3 19.3 17.7 17.7 17.1 19.3 16.5Z" fill="currentColor" stroke="none" />
  </>),
  shortcut: "W",
  title: "Varita — clic sobre una imagen la segmenta con SAM (Alt+clic excluye, doble clic o Enter aplica, Esc limpia)",
};

// Grupo 2 (flyout): lazo de cuerda con rizo.
const LASSO_TOOL: ToolDef = {
  key: "lasso",
  icon: aiSvg(<>
    <path d="M9.9 5C5.7 5.7 3.1 7.8 3.3 10.1c.3 3 4.4 4.9 9 4.5 1.5-.1 2.9-.5 4.1-1" />
    <path d="M9.9 5c4.5-.8 9.1.7 10.5 3 1.3 2.3-.6 4.6-4.1 5.6" />
    <path d="M9.6 14.7c-.9 1.5-.6 3 .5 3.4 1.2.4 2.6-.8 2.9-2.4" />
  </>),
  shortcut: "",
  title: "Lazo — dibuja un contorno para seleccionar lo que toque (Shift añade, Alt resta)",
};

// Grupo 3: pluma (nib con ojal) + añadir/borrar ancla + convertir.
const PEN_NIB = (
  <>
    <path d="M4.5 19.5c.4-3 1.7-5.9 3.9-8.1L15.7 4 20 8.3l-7.4 7.3c-2.2 2.2-5.1 3.5-8.1 3.9Z" />
    <circle cx="7.3" cy="16.7" r="1.5" />
  </>
);
const PEN_TOOLS: ToolDef[] = [
  { key: "pen", icon: aiSvg(PEN_NIB), shortcut: "P", title: "Pen — click to add points, drag for bezier" },
  { key: "pen-plus", icon: aiSvg(<><g transform="translate(-1.2 1.8)">{PEN_NIB}</g><path d="M17.5 3v5M15 5.5h5" /></>), shortcut: "+", title: "Pen + — click a segment to add a point" },
  { key: "pen-minus", icon: aiSvg(<><g transform="translate(-1.2 1.8)">{PEN_NIB}</g><path d="M15 5.5h5" /></>), shortcut: "−", title: "Pen − — click a point to delete it" },
  { key: "pen-edit", icon: aiSvg(<><g transform="translate(-1.2 -1.2)">{PEN_NIB}</g><path d="M14 14.5 20.8 17.2l-3.1 1.2-1.2 3.1Z" fill="currentColor" stroke="none" /></>), shortcut: "⇧C", title: "Convert — click a point to show bezier handles" },
];

// Grupo 4: curvatura — curva con manejadores cuadrados, botón propio.
const CURVATURE_TOOL: ToolDef = {
  key: "curvature",
  icon: aiSvg(<>
    <path d="M4.8 17.4C9.9 17.4 9.9 6.6 15 6.6c2 0 3.4.9 4.9 2.1" />
    <rect x="3.2" y="15.9" width="3" height="3" fill="currentColor" stroke="none" />
    <rect x="18.3" y="7.1" width="3" height="3" fill="currentColor" stroke="none" />
  </>),
  shortcut: "",
  title: "Curvatura — clic coloca puntos suaves; arrastra una ancla para re-curvar el trazado",
};

// Grupo 5: texto (T con serifas) + texto en trazado.
const TEXT_TOOLS: ToolDef[] = [
  { key: "text", icon: aiSvg(<path d="M5 5.5h14M7 5.5v2.1M17 5.5v2.1M12 5.5V19M9.4 19h5.2" />), shortcut: "T", title: "Text — click to place a text block" },
  { key: "text-path", icon: aiSvg(<><path d="M4 16.2c2.2-6.3 13.8-6.3 16 0" /><path d="M10 6.5h4M12 6.5V12" /></>), shortcut: "⇧T", title: "Text on Path — click a path to write along its curve" },
];

// Grupo 6: segmento de línea (\).
const LINE_TOOL: ToolDef = {
  key: "line",
  icon: aiSvg(<path d="M5 19 19 5" />),
  shortcut: "\\",
  title: "Line — drag to draw (Shift = 45°)",
};

// Grupo 7: rectángulo + elipse/polígonos en el flyout.
const SHAPE_TOOLS: ToolDef[] = [
  { key: "rect", icon: aiSvg(<rect x="4" y="6.5" width="16" height="11" />), shortcut: "R", title: "Rectangle" },
  { key: "circle", icon: aiSvg(<ellipse cx="12" cy="12" rx="8.2" ry="6.6" />), shortcut: "O", title: "Circle" },
  { key: "triangle", icon: <IconTriangle size={16} />, shortcut: "G", title: "Triangle" },
  { key: "star", icon: <IconStar size={16} />, shortcut: "S", title: "Star" },
  { key: "polygon", icon: <IconHexagon size={16} />, shortcut: "N", title: "Polygon (Shift for sides)" },
];

// Grupo 8/9: lápiz (grupo del pincel/lápiz de IA; aquí botón propio).
const PENCIL_TOOL: ToolDef = {
  key: "pencil",
  icon: aiSvg(<>
    <path d="M4.5 19.5 5.6 15.7 16.3 5a1.9 1.9 0 0 1 2.7 0l.5.5a1.9 1.9 0 0 1 0 2.7L8.8 18.9 4.5 19.5Z" />
    <path d="M14.9 6.4l3.2 3.2" />
  </>),
  shortcut: "B",
  title: "Pencil — freehand draw (hold and drag)",
};

// ── REQ-045: shape builder, borrador, corte y ancho ──
const SHAPE_BUILDER_TOOL: ToolDef = {
  key: "shape-builder",
  icon: aiSvg(<>
    <circle cx="8.4" cy="8.4" r="4.9" />
    <rect x="10.8" y="10.8" width="8.7" height="8.7" />
    <path d="M13.6 13.6 21 16.5l-3.1 1.2-1.2 3.1Z" fill="currentColor" stroke="none" />
  </>),
  shortcut: "",
  title: "Shape Builder — con ≥2 formas seleccionadas, arrastra sobre las caras para unirlas; Alt+arrastrar borra",
};

/** F4 Borrador. Its own button: over an <img> it paints non-destructive mask
 * strokes (Alt restores); over any other element it deletes it. */
const ERASER_TOOL: ToolDef = {
  key: "eraser",
  icon: aiSvg(<>
    <path d="M5 14.3 14.2 5.1a1.8 1.8 0 0 1 2.6 0l3 3a1.8 1.8 0 0 1 0 2.6L13 17.5H8.2L5 14.3Z" />
    <path d="M9.7 9.6l5.5 5.5" />
  </>),
  shortcut: "E",
  title: "Borrador — sobre imagen enmascara sin destruir (Alt restaura), sobre otros elementos borra (E)",
};

/** REQ-043 Tijeras y Cuchillo: los dos verbos de corte sobre paths. Botones
 *  propios (no variantes de la pluma) y sin atajo de teclado por ahora —
 *  las letras de la rail ya están tomadas por otras herramientas. */
const SCISSORS_TOOL: ToolDef = {
  key: "scissors",
  icon: aiSvg(<>
    <circle cx="5.5" cy="6.5" r="2.9" />
    <circle cx="5.5" cy="17.5" r="2.9" />
    <path d="M8.4 7.8 20.5 19M8.4 16.2 20.5 5" />
  </>),
  shortcut: "",
  title: "Tijeras — clic sobre un path para abrirlo por ese punto",
};

const KNIFE_TOOL: ToolDef = {
  key: "knife",
  icon: aiSvg(<>
    <path d="M3.5 20.5 13 11" />
    <path d="M13 11l5.6-7c1.6 1.4 1.9 3.8.6 5.5L15.3 15.1 13 11Z" />
  </>),
  shortcut: "",
  title: "Cuchillo — arrastra una línea para rebanar las formas que cruce",
};

// Ancho: perfil de trazo con las dos curvas y flecha hacia adentro (IA ~12).
const WIDTH_TOOL: ToolDef = {
  key: "width",
  icon: aiSvg(<>
    <path d="M8.3 4.5c-1.9 4.9-1.9 10.1 0 15" />
    <path d="M15.7 4.5c1.9 4.9 1.9 10.1 0 15" />
    <path d="M9.8 12h4.4M11.4 10.4 9.8 12l1.6 1.6M12.6 10.4l1.6 1.6-1.6 1.6" />
  </>),
  shortcut: "",
  title: "Ancho — arrastra sobre un trazo para puntos de perfil; Enter convierte el trazo en forma rellena",
};

// ── Grupo de pintura de IA: degradado (15), bote y live paint (~17) ──
const GRADIENT_TOOL: ToolDef = {
  key: "gradient",
  icon: aiSvg(<>
    <defs>
      <linearGradient id="ai-grad-tb" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="currentColor" stopOpacity="0.12" />
        <stop offset="1" stopColor="currentColor" stopOpacity="0.95" />
      </linearGradient>
    </defs>
    <rect x="4.5" y="4.5" width="15" height="15" fill="url(#ai-grad-tb)" />
  </>),
  shortcut: "",
  title: "Degradado — arrastra sobre una forma para aplicar un degradado lineal",
};

const LIVE_PAINT_TOOL: ToolDef = {
  key: "live-paint",
  icon: aiSvg(<>
    <path d="M9.6 3.5h3.8M11.5 3.5v2.4" />
    <path d="M7.1 10.4a4.4 4.4 0 0 1 8.8 0" />
    <path d="M6.5 10.4h11l-1 7.2a1.7 1.7 0 0 1-1.7 1.4h-5.6a1.7 1.7 0 0 1-1.7-1.4Z" />
  </>),
  shortcut: "",
  title: "Pintura interactiva (lite) — clic pinta la cara bajo el cursor con el color frontal; Esc sale",
};

const PAINT_BUCKET_TOOL: ToolDef = {
  key: "paint-bucket",
  icon: aiSvg(<>
    <path d="M5.2 12.4 11.7 5.9l6.3 6.3-6.5 6.5a2 2 0 0 1-2.8 0l-3.5-3.5a2 2 0 0 1 0-2.8Z" />
    <path d="M13.2 7.4c2.3-2.3 5-2.1 6.7-.4" />
    <path d="M20.7 15.4l1.6 2.7a1.9 1.9 0 1 1-3.2 0z" fill="currentColor" stroke="none" />
  </>),
  shortcut: "K",
  title: "Bote de pintura — clic rellena la forma cerrada bajo el cursor con el color frontal",
};

// Frame = herramienta de mesa de trabajo de IA: rectángulo con esquinas.
const FRAME_TOOL: ToolDef = {
  key: "frame",
  icon: aiSvg(<>
    <rect x="6" y="5.5" width="12" height="13" />
    <path d="M3.5 9.5v-2a2 2 0 0 1 2-2h2M15.5 3.5h2a2 2 0 0 1 2 2v2M20.5 14.5v2a2 2 0 0 1-2 2h-2M8.5 20.5h-2a2 2 0 0 1-2-2v-2" />
  </>),
  shortcut: "F",
  title: "Frame — click for 100×100, drag for custom size",
};

const EYEDROPPER_TOOL: ToolDef = {
  key: "eyedropper",
  icon: aiSvg(<>
    <path d="M17.9 3.7a2.5 2.5 0 0 1 3.5 3.5l-2.2 2.2-3.5-3.5 2.2-2.2Z" />
    <path d="M14.8 6.8l3.5 3.5-8.3 8.3-4.7 1.4 1.4-4.7 8.1-8.5Z" />
  </>),
  shortcut: "I",
  title: "Cuentagotas — clic toma el color de cualquier elemento",
};

// Zoom: lupa con más; sin atajo (Z ya es zoom-in del teclado, REQ-044).
const ZOOM_TOOL: ToolDef = {
  key: "zoom",
  icon: aiSvg(<>
    <circle cx="10.5" cy="10.5" r="6.6" />
    <path d="M15.4 15.4 21 21" />
    <path d="M10.5 7.7v5.6M7.7 10.5h5.6" />
  </>),
  shortcut: "",
  title: "Zoom — clic acerca en el punto, Alt+clic aleja (la rueda ya hace pinch)",
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
      {/* ── Orden Illustrator: selección → varita → lazo → pluma →
          curvatura → texto → línea → formas ── */}
      {toolBtn(SELECT_TOOL.key, SELECT_TOOL.icon, SELECT_TOOL.shortcut, SELECT_TOOL.title)}

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

      {toolBtn(LASSO_TOOL.key, LASSO_TOOL.icon, LASSO_TOOL.shortcut, LASSO_TOOL.title)}

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

      {/* ── Curvatura: botón propio, como en IA ── */}
      {toolBtn(CURVATURE_TOOL.key, CURVATURE_TOOL.icon, CURVATURE_TOOL.shortcut, CURVATURE_TOOL.title)}

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

      {/* ── Línea: segmento recto (\) ── */}
      {toolBtn(LINE_TOOL.key, LINE_TOOL.icon, LINE_TOOL.shortcut, LINE_TOOL.title)}

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

      {divider}

      {/* ── Lápiz y shape builder ── */}
      {toolBtn(PENCIL_TOOL.key, PENCIL_TOOL.icon, PENCIL_TOOL.shortcut, PENCIL_TOOL.title)}
      {toolBtn(SHAPE_BUILDER_TOOL.key, SHAPE_BUILDER_TOOL.icon, SHAPE_BUILDER_TOOL.shortcut, SHAPE_BUILDER_TOOL.title)}

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

      {/* ── REQ-043 Tijeras + Cuchillo: corte sobre paths ── */}
      {toolBtn(SCISSORS_TOOL.key, SCISSORS_TOOL.icon, SCISSORS_TOOL.shortcut, SCISSORS_TOOL.title)}
      {toolBtn(KNIFE_TOOL.key, KNIFE_TOOL.icon, KNIFE_TOOL.shortcut, KNIFE_TOOL.title)}

      {/* ── REQ-045 (Fase 3): ancho ── */}
      {toolBtn(WIDTH_TOOL.key, WIDTH_TOOL.icon, WIDTH_TOOL.shortcut, WIDTH_TOOL.title)}

      {/* ── Pintura de IA: degradado, live paint y bote ── */}
      {toolBtn(GRADIENT_TOOL.key, GRADIENT_TOOL.icon, GRADIENT_TOOL.shortcut, GRADIENT_TOOL.title)}
      {toolBtn(LIVE_PAINT_TOOL.key, LIVE_PAINT_TOOL.icon, LIVE_PAINT_TOOL.shortcut, LIVE_PAINT_TOOL.title)}
      {toolBtn(PAINT_BUCKET_TOOL.key, PAINT_BUCKET_TOOL.icon, PAINT_BUCKET_TOOL.shortcut, PAINT_BUCKET_TOOL.title)}

      {/* ── Frame (mesa de trabajo), cuentagotas, mano y zoom cierran la rail ── */}
      {toolBtn(FRAME_TOOL.key, FRAME_TOOL.icon, FRAME_TOOL.shortcut, FRAME_TOOL.title)}
      {toolBtn(EYEDROPPER_TOOL.key, EYEDROPPER_TOOL.icon, EYEDROPPER_TOOL.shortcut, EYEDROPPER_TOOL.title)}
      {toolBtn("hand", <IconHand size={16} />, "H", "Hand — drag to pan")}
      {toolBtn(ZOOM_TOOL.key, ZOOM_TOOL.icon, ZOOM_TOOL.shortcut, ZOOM_TOOL.title)}

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
