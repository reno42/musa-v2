import { useState, useCallback } from "react";
import type { FrameData } from "./DesignFrame";

export type ExportFormat = "png" | "jpg" | "svg" | "pdf" | "json" | "tokens" | "designSystem" | "css";

// JSON (a full template backup), Tokens, Design.md (DESIGN.md + tokens.json
// + shared.css), and CSS (every frame's stylesheet, combined) all operate
// on the WHOLE template, never a specific frame.
const WHOLE_TEMPLATE_FORMATS = new Set<ExportFormat>(["json", "tokens", "designSystem", "css"]);

interface ExportPanelProps {
  /** Every frame in the template — only used to gate JSON/Tokens (a template
   *  with zero frames has nothing to export either way). */
  frames: FrameData[];
  /** The frames export will actually act on for PNG/JPG/SVG/PDF: the
   *  current multi-select, or the single active frame if nothing is
   *  multi-selected. There's no separate "all frames" mode — select what
   *  you want exported. */
  selectedFrames: FrameData[];
  onExport: (format: ExportFormat) => void;
}

/**
 * Export Panel — format dropdown + export button. Compact inline component
 * for the editor toolbar.
 */
export function ExportPanel({ frames, selectedFrames, onExport }: ExportPanelProps) {
  const [format, setFormat] = useState<ExportFormat>("png");
  const [exporting, setExporting] = useState(false);

  const isWholeTemplate = WHOLE_TEMPLATE_FORMATS.has(format);
  const hasSelection = isWholeTemplate ? frames.length > 0 : selectedFrames.length > 0;

  const handleExport = useCallback(async () => {
    if (!hasSelection) return;
    setExporting(true);
    try {
      await onExport(format);
    } finally {
      setExporting(false);
    }
  }, [format, hasSelection, onExport]);

  let buttonLabel = "Exportar";
  if (exporting) buttonLabel = "Exportando...";
  else if (!isWholeTemplate && selectedFrames.length > 1) buttonLabel = `Exportar (${selectedFrames.length})`;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {/* Format dropdown */}
      <select
        value={format}
        onChange={e => setFormat(e.target.value as ExportFormat)}
        className="editor-v2-export-select"
        style={{
          background: "var(--editor-bg-3, #1e1e2e)",
          color: "var(--editor-text, #e0e0f0)",
          border: "1px solid var(--editor-border, #333346)",
          borderRadius: 6,
          padding: "4px 8px",
          fontSize: 12,
          cursor: "pointer",
          outline: "none",
        }}
      >
        <option value="png">PNG</option>
        <option value="jpg">JPG</option>
        <option value="svg">SVG</option>
        <option value="pdf">PDF</option>
        <option value="json">JSON (template)</option>
        <option value="tokens">Design Tokens</option>
        <option value="designSystem">Design.md</option>
        <option value="css">CSS</option>
      </select>

      {/* Export button — for PNG/JPG/SVG/PDF this exports every currently
          selected frame (select 3 of 7 to hand off just those 3), so the
          label surfaces the count once it's more than one. */}
      <button
        type="button"
        onClick={handleExport}
        disabled={!hasSelection || exporting}
        title={!isWholeTemplate && selectedFrames.length === 0 ? "Select a frame to export" : undefined}
        className="editor-v2-export-btn"
        style={{
          background: hasSelection && !exporting
            ? "var(--editor-accent, #6c5ce7)"
            : "var(--editor-bg-4, #2a2a3e)",
          color: hasSelection && !exporting ? "#fff" : "var(--editor-text-dim, #888)",
          border: "none",
          borderRadius: 6,
          padding: "4px 14px",
          fontSize: 12,
          fontWeight: 600,
          cursor: hasSelection && !exporting ? "pointer" : "default",
          transition: "opacity 0.15s",
          opacity: exporting ? 0.6 : 1,
          whiteSpace: "nowrap",
        }}
      >
        {buttonLabel}
      </button>
    </div>
  );
}
