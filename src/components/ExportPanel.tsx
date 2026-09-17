import { useState, useCallback } from "react";
import type { FrameData } from "./DesignFrame";
import { IconDownload, IconChevronDown } from "../shared/icons";
import { TopbarMenu, TopbarMenuItem } from "./TopbarMenu";

// "printPdf" no exporta directo: abre PrintExportDialog (300dpi + CMYK +
// soft-proof) — el único formato con opciones, por eso termina en "…".
export type ExportFormat = "png" | "jpg" | "svg" | "pdf" | "printPdf" | "json" | "tokens" | "designSystem" | "css";

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

// The 8 formats used to be a native <select> plus a separate Exportar
// button (~200px of topbar for two controls). Now the format IS the menu
// entry: one trigger, and clicking a format exports in that format
// directly — same dropdown pattern as Vista/IA/Compartir.
const FRAME_FORMATS: Array<{ format: ExportFormat; title: string; desc: string }> = [
  { format: "png", title: "PNG", desc: "Imagen con transparencia" },
  { format: "jpg", title: "JPG", desc: "Imagen liviana, sin transparencia" },
  { format: "svg", title: "SVG", desc: "Vector editable" },
  { format: "pdf", title: "PDF", desc: "Documento, listo para imprimir" },
];

const WHOLE_FORMATS: Array<{ format: ExportFormat; title: string; desc: string }> = [
  { format: "json", title: "JSON (template)", desc: "Backup completo" },
  { format: "tokens", title: "Design Tokens", desc: "Paleta y tipografía en DTCG" },
  { format: "designSystem", title: "Design.md", desc: "Guía + tokens + CSS compartido" },
  { format: "css", title: "CSS", desc: "Hojas de estilo de todos los frames" },
];

export function ExportPanel({ frames, selectedFrames, onExport }: ExportPanelProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const runExport = useCallback(async (format: ExportFormat) => {
    const ok = WHOLE_TEMPLATE_FORMATS.has(format)
      ? frames.length > 0
      : selectedFrames.length > 0;
    if (!ok) return;
    setMenuOpen(false);
    setExporting(true);
    try {
      await onExport(format);
    } finally {
      setExporting(false);
    }
  }, [frames.length, selectedFrames.length, onExport]);

  // Same information the old two controls carried: busy state on the
  // trigger, and the multi-select count (PNG/JPG/SVG/PDF export every
  // currently selected frame — select 3 of 7 to hand off just those 3).
  const n = selectedFrames.length;
  const label = exporting ? "Exportando…" : n > 1 ? `Exportar (${n})` : "Exportar";

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        className={`editor-v2-topbar-icon-btn ${menuOpen ? "active" : ""}`}
        onClick={() => setMenuOpen(v => !v)}
        title="Exportar — elige el formato (frames seleccionados o todo el archivo)"
      >
        <IconDownload size={14} />
        <span style={{ fontSize: 12, marginLeft: 4 }}>{label}</span>
        <span style={{ marginLeft: 3, display: "flex" }}><IconChevronDown size={11} /></span>
      </button>
      <TopbarMenu open={menuOpen} onClose={() => setMenuOpen(false)} width={300}>
        {FRAME_FORMATS.map(({ format, title, desc }) => (
          <TopbarMenuItem
            key={format}
            title={title}
            desc={n > 0 ? `${desc} · ${n > 1 ? `${n} frames seleccionados` : "el frame seleccionado"}` : "Selecciona un frame primero"}
            disabled={n === 0 || exporting}
            onClick={() => { void runExport(format); }}
          />
        ))}
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", margin: "3px 4px" }} />
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.8, textTransform: "uppercase", color: "#8a8a8a", padding: "4px 12px" }}>Impresión</div>
        <TopbarMenuItem
          key="printPdf"
          title="PDF Impresión…"
          desc={n > 0 ? `300 dpi · A4/Carta/CMYK · ${n > 1 ? `${n} frames seleccionados` : "el frame seleccionado"}` : "Selecciona un frame primero"}
          disabled={n === 0 || exporting}
          onClick={() => { void runExport("printPdf"); }}
        />
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", margin: "3px 4px" }} />
        {WHOLE_FORMATS.map(({ format, title, desc }) => (
          <TopbarMenuItem
            key={format}
            title={title}
            desc={`${desc} · todo el archivo`}
            disabled={frames.length === 0 || exporting}
            onClick={() => { void runExport(format); }}
          />
        ))}
      </TopbarMenu>
    </div>
  );
}
