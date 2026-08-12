import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SelectedElementInfo } from "./DesignFrame";

/**
 * The canvas right-click menu.
 *
 * It used to be a text-formatting panel — font, size, colour, alignment —
 * which duplicated the right-hand panel and offered none of the commands a
 * right click is actually reached for. Those live here now; formatting stays
 * where it belongs, in the contextual panel.
 *
 * A command that cannot apply to the current selection is shown disabled
 * rather than hidden, so the menu keeps a stable shape and says why.
 */

export interface ContextMenuActions {
  onCopy: () => void;
  onPaste: () => void;
  onPasteAllFrames: () => void;
  onStackChange: (move: "forward" | "backward" | "front" | "back") => void;
  onGroup: () => void;
  onUngroup: () => void;
  onUngroupAll: () => void;
  onToggleVisibility: () => void;
  onToggleLock: () => void;
  onFlip: (axis: "horizontal" | "vertical") => void;
  onCopyCode: () => void;
  onCopyCss: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onBatchAMator: () => void;
  onFrameToTemplate: () => void;
  onExtractDesignSystem: () => void;
  onInspect: () => void;
}

interface Props extends ContextMenuActions {
  x: number;
  y: number;
  selectedElement: SelectedElementInfo | null;
  /** Layers selected right now — grouping needs two or more. */
  selectedLayerCount: number;
  hasFrameSelection: boolean;
  isHidden: boolean;
  isLocked: boolean;
  canUndo: boolean;
  canRedo: boolean;
  hasClipboard: boolean;
  onClose: () => void;
}

interface MenuEntry {
  /** A separator carries no label. */
  separator?: true;
  label?: string;
  hint?: string;
  disabled?: boolean;
  run?: () => void;
}

const MENU_WIDTH = 250;
/** Kept clear of the viewport edge so the menu never sits flush against it. */
const VIEWPORT_MARGIN = 8;

export function CanvasContextMenu({
  x, y, selectedElement, selectedLayerCount, hasFrameSelection,
  isHidden, isLocked, canUndo, canRedo, hasClipboard, onClose,
  onCopy, onPaste, onPasteAllFrames, onStackChange, onGroup, onUngroup, onUngroupAll,
  onToggleVisibility, onToggleLock, onFlip, onCopyCode, onCopyCss,
  onUndo, onRedo, onBatchAMator, onFrameToTemplate, onExtractDesignSystem, onInspect,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Measured after layout rather than guessed: the menu's height depends on
  // how many entries it ends up with, and a right click near the bottom of the
  // window would otherwise open a menu running off the screen.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    setPosition({
      left: Math.max(VIEWPORT_MARGIN, Math.min(x, window.innerWidth - width - VIEWPORT_MARGIN)),
      top: Math.max(VIEWPORT_MARGIN, Math.min(y, window.innerHeight - height - VIEWPORT_MARGIN)),
    });
  }, [x, y]);

  const hasElement = Boolean(selectedElement);
  const isGroup = Boolean(selectedElement?.childLayerCount);

  const run = (action: () => void) => () => { action(); onClose(); };

  const entries: MenuEntry[] = [
    { label: "Copiar", hint: "Ctrl+C", disabled: !hasElement && !hasFrameSelection, run: onCopy },
    { label: "Pegar", hint: "Ctrl+V", disabled: !hasClipboard, run: onPaste },
    { label: "Pegar en todos los frames", disabled: !hasClipboard, run: onPasteAllFrames },
    { separator: true },
    { label: "Bring forward", disabled: !hasElement, run: () => onStackChange("forward") },
    { label: "Bring backward", disabled: !hasElement, run: () => onStackChange("backward") },
    { label: "Bring to front", disabled: !hasElement, run: () => onStackChange("front") },
    { label: "Bring to back", disabled: !hasElement, run: () => onStackChange("back") },
    { separator: true },
    { label: "Agrupar", hint: "Ctrl+G", disabled: selectedLayerCount < 2, run: onGroup },
    { label: "Desagrupar", disabled: !isGroup, run: onUngroup },
    { label: "Desagrupar todo", disabled: !isGroup, run: onUngroupAll },
    { separator: true },
    { label: isHidden ? "Show" : "Hide", disabled: !hasElement, run: onToggleVisibility },
    { label: isLocked ? "Unlock" : "Lock", disabled: !hasElement, run: onToggleLock },
    { label: "Flip Horizontal", disabled: !hasElement, run: () => onFlip("horizontal") },
    { label: "Flip Vertical", disabled: !hasElement, run: () => onFlip("vertical") },
    { separator: true },
    // Both copy the SELECTED element's markup, so without one there is
    // nothing to copy and the command would silently do nothing.
    { label: "Copiar código (HTML + CSS)", disabled: !hasElement, run: onCopyCode },
    { label: "Copiar CSS", disabled: !hasElement, run: onCopyCss },
    { separator: true },
    { label: "Undo", hint: "Ctrl+Z", disabled: !canUndo, run: onUndo },
    { label: "Redo", hint: "Ctrl+Shift+Z", disabled: !canRedo, run: onRedo },
    { separator: true },
    { label: "BatchAMator", run: onBatchAMator },
    { label: "Convertir frame en plantilla", disabled: !hasFrameSelection, run: onFrameToTemplate },
    { label: "Convertir archivo en design system", run: onExtractDesignSystem },
    { separator: true },
    { label: "Inspeccionar", hint: "F12", disabled: !hasElement, run: onInspect },
  ];

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Acciones del lienzo"
      style={{
        position: "fixed", left: position.left, top: position.top, zIndex: 1000,
        width: MENU_WIDTH, maxHeight: `calc(100vh - ${VIEWPORT_MARGIN * 2}px)`, overflowY: "auto",
        background: "rgba(17,17,24,0.98)", border: "1px solid #26262f", borderRadius: 8,
        boxShadow: "0 12px 40px rgba(0,0,0,0.55)", padding: 4,
        backdropFilter: "blur(20px) saturate(180%)", WebkitBackdropFilter: "blur(20px) saturate(180%)",
      }}
    >
      {entries.map((entry, index) => entry.separator ? (
        <div key={`sep-${index}`} style={{ height: 1, background: "#26262f", margin: "4px 6px" }} />
      ) : (
        <button
          key={entry.label}
          type="button"
          role="menuitem"
          disabled={entry.disabled}
          onClick={entry.disabled ? undefined : run(entry.run as () => void)}
          style={{
            width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: 12, background: "transparent", border: "none", borderRadius: 4,
            padding: "5px 8px", fontSize: 12.5, textAlign: "left",
            color: entry.disabled ? "#5a5850" : "#f0ebe0",
            cursor: entry.disabled ? "default" : "pointer",
          }}
          onMouseOver={e => { if (!entry.disabled) e.currentTarget.style.background = "rgba(255,255,255,0.07)"; }}
          onMouseOut={e => { e.currentTarget.style.background = "transparent"; }}
        >
          <span>{entry.label}</span>
          {entry.hint && (
            <span style={{ fontSize: 10.5, color: entry.disabled ? "#4a4842" : "#7a7668" }}>{entry.hint}</span>
          )}
        </button>
      ))}
    </div>
  );
}
