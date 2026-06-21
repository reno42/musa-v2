import { type HtmlToolName } from "./InfiniteHtmlCanvas";

/**
 * HtmlToolbar — General tools for the HTML design editor.
 * Mirrors the "tools on the desk" metaphor.
 */

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
  saving: boolean;
}

const FRAME_PRESETS = [
  { name: "IG Square", width: 1080, height: 1080 },
  { name: "IG Story", width: 1080, height: 1920 },
  { name: "IG Feed", width: 1080, height: 1350 },
  { name: "Banner", width: 1920, height: 1080 },
  { name: "Twitter", width: 1200, height: 628 },
];

const btn = (active?: boolean): React.CSSProperties => ({
  background: active ? "#3B82F6" : "rgba(255,255,255,0.06)",
  color: active ? "#fff" : "#c4c0b4",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 6,
  padding: "5px 10px",
  cursor: "pointer",
  fontSize: 12,
  fontFamily: "inherit",
  display: "flex",
  alignItems: "center",
  gap: 4,
});

const sep: React.CSSProperties = {
  width: 1, height: 20, background: "rgba(255,255,255,0.08)", margin: "0 4px",
};

export function HtmlToolbar({
  tool, onToolChange, onAddFrame,
  onZoomIn, onZoomOut, onZoomToFit, zoom,
  canUndo, canRedo, onUndo, onRedo, saving,
}: Props) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 4, padding: "4px 8px",
      borderBottom: "1px solid rgba(255,255,255,0.06)",
      background: "rgba(18,18,36,0.85)", backdropFilter: "blur(10px)",
      flexShrink: 0, flexWrap: "wrap",
    }}>
      {/* Undo / Redo */}
      <button type="button" onClick={onUndo} disabled={!canUndo} style={{ ...btn(), opacity: canUndo ? 1 : 0.4 }} title="Undo (Ctrl+Z)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12.5 8c-2.65 0-5.05 1.04-6.83 2.73L3 8v9h9l-3.62-3.62C9.89 12.02 11.12 11.5 12.5 11.5c2.28 0 4.22 1.52 4.84 3.58l2.87-.78C19.36 11.38 16.21 8 12.5 8z"/></svg>
      </button>
      <button type="button" onClick={onRedo} disabled={!canRedo} style={{ ...btn(), opacity: canRedo ? 1 : 0.4 }} title="Redo (Ctrl+Shift+Z)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.16 0-7.74 2.42-9.44 5.93l2.57 1.11C5.9 12.55 8.47 11 11.5 11c2.09 0 3.99.75 5.47 1.98L13 17h9V8l-3.6 2.6z"/></svg>
      </button>

      <div style={sep} />

      {/* Select Tool */}
      <button type="button" onClick={() => onToolChange("select")} style={btn(tool === "select")} title="Select (V) — grab and move frames/elements">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 2l12 11.2-5.8.8 3.5 6.1-1.7 1-3.5-6.1L7 19z"/></svg>
        <span style={{ fontSize: 10, color: "#888" }}>V</span>
      </button>

      {/* Hand Tool */}
      <button type="button" onClick={() => onToolChange("hand")} style={btn(tool === "hand")} title="Hand (H) — pan the infinite desk">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a3 3 0 0 0-3 3v7H8a3 3 0 0 0-3 3v2a7 7 0 0 0 14 0v-6a3 3 0 0 0-3-3h-1V5a3 3 0 0 0-3-3z"/></svg>
        <span style={{ fontSize: 10, color: "#888" }}>H</span>
      </button>

      <div style={sep} />

      {/* Frame Presets */}
      {FRAME_PRESETS.map(p => (
        <button
          key={p.name}
          type="button"
          onClick={() => onAddFrame(p)}
          style={{ ...btn(), fontSize: 10, padding: "4px 6px" }}
          title={`Add ${p.name} frame (${p.width}x${p.height})`}
        >
          + {p.name}
        </button>
      ))}

      <div style={sep} />

      {/* Zoom */}
      <button type="button" onClick={onZoomOut} style={btn()} title="Zoom Out">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14zM7 9h5v1H7z"/></svg>
      </button>
      <button type="button" onClick={onZoomToFit} style={{ ...btn(), fontSize: 10 }}>
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" onClick={onZoomIn} style={btn()} title="Zoom In">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14zM12 10h-2v2H9v-2H7V9h2V7h1v2h2v1z"/></svg>
      </button>
      <button type="button" onClick={onZoomToFit} style={{ ...btn(), fontSize: 10 }} title="Fit all frames">
        Fit
      </button>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {saving && <span style={{ fontSize: 10, color: "#60a5fa" }}>Saving...</span>}
    </div>
  );
}
