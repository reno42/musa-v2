/**
 * Toolbar Component
 * ──────────────────────────────────────────────────────────────
 * Vertical toolbar with grouped tools, dropdown popups,
 * undo/redo, zoom controls, and export actions.
 *
 * @module components/Toolbar
 */

import type { ToolName } from "../hooks/useCanvas";
import type { BooleanOperation } from "@futuraria/shared";
import { useDropdowns } from "../hooks/useDropdowns";
import { ToolBtn, Divider, Spacer } from "./toolbar/ToolbarButtons";
import { ShapesDropdown, DrawDropdown, AlignDropdown, BooleanDropdown } from "./toolbar/ToolbarDropdowns";
import { EmbedsDropdown } from "./toolbar/EmbedsDropdown";
import { BlocksDropdown } from "./toolbar/BlocksDropdown";
import { SnapDropdown } from "./toolbar/SnapDropdown";
import { GalleryDropdown } from "./toolbar/GalleryDropdown";

type AlignDirection = "left" | "center-h" | "right" | "top" | "center-v" | "bottom";
type EmbedType = "video" | "audio" | "pdf" | "figma" | "social";

interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
}

interface SelectionState {
  hasMultiSelection: boolean;
  canBooleanOp: boolean;
}

interface Props {
  templateId: string | null;
  tool: ToolName;
  onToolChange: (tool: ToolName) => void;
  onExportPNG: () => void;
  onExportSVG: () => void;
  onExportJSON: () => void;
  onExportFrame: () => void;
  onExportAllFrames: () => void;
  onExportPDF: () => void;
  frameCount: number;
  frameMax: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomToFit: () => void;
  zoom: number;
  history: HistoryState;
  onUndo: () => void;
  onRedo: () => void;
  onAlign: (direction: AlignDirection) => void;
  onDistribute: (direction: "horizontal" | "vertical") => void;
  selection: SelectionState;
  onAutoLayout?: () => void;
  onBooleanOp: (op: BooleanOperation) => void;
  onPrototypePreview?: () => void;
  onEmbed?: (url: string, type: EmbedType) => void;
  onBlockAction?: (method: string, params: Record<string, any>) => void;
  onGalleryCreate?: (params: {
    images: { url: string; caption?: string }[];
    columns: number;
    imageWidth: number;
    imageHeight: number;
    gap: number;
    x: number;
    y: number;
  }) => void;
}

export function Toolbar({
  templateId,
  tool, onToolChange,
  onExportPNG, onExportSVG, onExportJSON,
  onExportFrame, onExportAllFrames,
  frameCount, frameMax,
  onZoomIn, onZoomOut, onZoomToFit, zoom,
  history, onUndo, onRedo,
  onAlign, onDistribute, selection,
  onAutoLayout,
  onBooleanOp,
  onPrototypePreview,
  onEmbed,
  onBlockAction,
  onGalleryCreate,
}: Props) {
  const {
    alignOpen, boolOpen, shapesOpen, drawOpen,
    dispatch, alignRef, boolRef, shapesRef, drawRef,
  } = useDropdowns();

  return (
    <div className="toolbar">
      {/* ─── Undo / Redo ─── */}
      <button type="button" className={`tool-btn ${!history.canUndo ? "disabled" : ""}`} onClick={onUndo} disabled={!history.canUndo} title="Undo (⌘Z)" aria-label="Undo">
        <svg viewBox="0 0 24 24"><path d="M12.5 8c-2.65 0-5.05 1.04-6.83 2.73L3 8v9h9l-3.62-3.62C9.89 12.02 11.12 11.5 12.5 11.5c2.28 0 4.22 1.52 4.84 3.58l2.87-.78C19.36 11.38 16.21 8 12.5 8z" /></svg>
      </button>
      <button type="button" className={`tool-btn ${!history.canRedo ? "disabled" : ""}`} onClick={onRedo} disabled={!history.canRedo} title="Redo (⌘⇧Z)" aria-label="Redo">
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

      {/* ─── Draw ─── */}
      <DrawDropdown tool={tool} onToolChange={onToolChange} open={drawOpen} dropdownRef={drawRef} dispatch={dispatch} />

      <Divider />

      {/* ─── Shapes ─── */}
      <ShapesDropdown tool={tool} onToolChange={onToolChange} open={shapesOpen} dropdownRef={shapesRef} dispatch={dispatch} />

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

      {/* ─── Embed ─── */}
      {onEmbed && <EmbedsDropdown onEmbed={onEmbed} />}

      {/* ─── Blocks ─── */}
      {onBlockAction && <BlocksDropdown onBlockAction={onBlockAction} />}

      {/* ─── Snap ─── */}
      <SnapDropdown />

      {/* ─── Gallery ─── */}
      {onGalleryCreate && <GalleryDropdown templateId={templateId} onGalleryCreate={onGalleryCreate} />}

      <Divider />

      {/* ─── Auto Layout ─── */}
      <button type="button" className="tool-btn" onClick={onAutoLayout} title="Auto Layout (⇧A)" aria-label="Auto Layout">
        <svg viewBox="0 0 24 24">
          <rect x="3" y="3" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <span className="shortcut">⇧A</span>
      </button>

      {/* ─── Alignment ─── */}
      <AlignDropdown
        onAlign={onAlign} onDistribute={onDistribute}
        open={alignOpen} enabled={selection.hasMultiSelection}
        dropdownRef={alignRef} dispatch={dispatch}
      />

      {/* ─── Boolean Operations ─── */}
      <BooleanDropdown
        onBooleanOp={onBooleanOp}
        open={boolOpen} enabled={selection.canBooleanOp}
        dropdownRef={boolRef} dispatch={dispatch}
      />

      <Divider />

      {/* ─── Zoom ─── */}
      <button type="button" className="tool-btn" onClick={onZoomOut} title="Zoom Out (-)" aria-label="Zoom Out">
        <svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14zM7 9h5v1H7z" /></svg>
      </button>
      <div className="tool-btn zoom-display">{Math.round(zoom * 100)}%</div>
      <button type="button" className="tool-btn" onClick={onZoomIn} title="Zoom In (+)" aria-label="Zoom In">
        <svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14zM12 10h-2v2H9v-2H7V9h2V7h1v2h2v1z" /></svg>
      </button>
      <button type="button" className="tool-btn" onClick={onZoomToFit} title="Fit to screen (⌘1)" aria-label="Fit to screen">
        <svg viewBox="0 0 24 24"><path d="M3 5v4h2V5h4V3H5a2 2 0 0 0-2 2zm16-2h-4v2h4v4h2V5a2 2 0 0 0-2-2zM5 19h4v2H5a2 2 0 0 1-2-2v-4h2v4zm14 0v-4h2v4a2 2 0 0 1-2 2h-4v-2h4z" /></svg>
      </button>

      <Spacer />

      {/* ─── Prototype Preview ─── */}
      {onPrototypePreview && (
        <button type="button" className="tool-btn proto-toolbar-btn" onClick={onPrototypePreview} title="Prototype Preview (⌘P)" aria-label="Prototype Preview">
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
        </button>
      )}

      {/* ─── Export Group ─── */}
      <div className="export-group">
        {frameCount > 0 && (
          <>
            <button type="button" className="tool-btn" onClick={onExportFrame} title="Export First Frame as PNG" aria-label="Export Frame PNG">
              <svg viewBox="0 0 24 24"><path d="M4 4h16v16H4zM2 2v20h20V2z" fillRule="evenodd" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M9 12l2 2 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
            </button>
            <button type="button" className="tool-btn" onClick={onExportAllFrames} title={`Export All Frames (${frameCount}/${frameMax})`} aria-label="Export All Frames">
              <svg viewBox="0 0 24 24"><rect x="2" y="2" width="8" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" /><rect x="14" y="2" width="8" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" /><rect x="2" y="14" width="8" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" /><rect x="14" y="14" width="8" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M5 5v2m2-2v2M5 12v2m2-2v2M5 19v2m2-2v2" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.5" /></svg>
            </button>
          </>
        )}
        <button type="button" className="tool-btn" onClick={onExportPNG} title="Export Canvas PNG" aria-label="Export PNG">
          <svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" /></svg>
        </button>
        <button type="button" className="tool-btn" onClick={onExportSVG} title="Export SVG" aria-label="Export SVG">
          <svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" /></svg>
        </button>
        <button type="button" className="tool-btn" onClick={onExportJSON} title="Export JSON" aria-label="Export JSON">
          <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2l5 5h-5V4zM6 20V4h5v7h7v9H6z" /></svg>
        </button>
      </div>
    </div>
  );
}
