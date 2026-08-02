import { useState, useCallback } from "react";
import type { FrameData } from "./DesignFrame";

export type ExportFormat = "png" | "jpg" | "svg" | "pdf" | "json" | "tokens";
export type ExportScope = "current" | "all";

// JSON (a full template backup) and Tokens (the extracted design system)
// both operate on the WHOLE template, never a single frame — the
// current/all-frames scope toggle doesn't mean anything for either.
const WHOLE_TEMPLATE_FORMATS = new Set<ExportFormat>(["json", "tokens"]);

interface ExportPanelProps {
  frames: FrameData[];
  selectedFrame: FrameData | null;
  onExport: (format: ExportFormat, scope: ExportScope) => void;
}

/**
 * Export Panel — format dropdown + scope toggle + export button.
 * Compact inline component for the editor toolbar.
 */
export function ExportPanel({ frames, selectedFrame, onExport }: ExportPanelProps) {
  const [format, setFormat] = useState<ExportFormat>("png");
  const [scope, setScope] = useState<ExportScope>("current");
  const [exporting, setExporting] = useState(false);

  const handleExport = useCallback(async () => {
    if (!WHOLE_TEMPLATE_FORMATS.has(format) && scope === "current" && !selectedFrame) return;
    setExporting(true);
    try {
      await onExport(format, scope);
    } finally {
      setExporting(false);
    }
  }, [format, scope, selectedFrame, onExport]);

  const isWholeTemplate = WHOLE_TEMPLATE_FORMATS.has(format);
  const hasSelection = isWholeTemplate ? true : (scope === "current" ? !!selectedFrame : frames.length > 0);

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
      </select>

      {/* Scope toggle — meaningless for JSON/Tokens, which always export the
          whole template, so it's hidden rather than left showing an option
          that silently does nothing. */}
      {!isWholeTemplate && (
      <select
        value={scope}
        onChange={e => setScope(e.target.value as ExportScope)}
        className="editor-v2-export-scope"
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
        <option value="current">Frame actual</option>
        <option value="all">Todos los frames</option>
      </select>
      )}

      {/* Export button */}
      <button
        type="button"
        onClick={handleExport}
        disabled={!hasSelection || exporting}
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
        }}
      >
        {exporting ? "Exportando..." : "Exportar"}
      </button>
    </div>
  );
}
