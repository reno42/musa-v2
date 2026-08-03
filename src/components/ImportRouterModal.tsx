import { useState, useCallback, useRef } from "react";

export type ImportRoute = "svg" | "design" | "html" | "template";

interface ImportRouterModalProps {
  onClose: () => void;
  /** User picked (or we auto-detected) a destination tool. `file` is set
   *  when routing came from a dropped/browsed file, so the target tool can
   *  pre-load it instead of asking the user to pick it again. */
  onRoute: (route: ImportRoute, file?: File) => void;
}

const EXT_ROUTES: Record<string, ImportRoute> = {
  svg: "svg",
  psd: "design",
  ai: "design",
  fig: "design",
  html: "html",
  htm: "html",
  json: "template",
};

export function detectRoute(file: File): ImportRoute | null {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  return EXT_ROUTES[ext] || null;
}

/**
 * Single "Import" entry point. Drop or browse a file and it's routed to the
 * right specialized importer automatically (SVG editor, design-file import,
 * HTML/CSS import, or template-JSON restore) — the tools underneath are
 * unchanged, this is just a thinner front door so the user only has to find
 * one button. Ambiguous/unrecognized files (e.g. PNG/JPG, which more than
 * one tool can handle) fall back to the manual picker below.
 */
export function ImportRouterModal({ onClose, onRoute }: ImportRouterModalProps) {
  const [dragOver, setDragOver] = useState(false);
  const [unrecognized, setUnrecognized] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const templateFileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((file: File) => {
    const route = detectRoute(file);
    if (route) {
      setUnrecognized(null);
      onRoute(route, file);
    } else {
      setUnrecognized(file);
    }
  }, [onRoute]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  }, [handleFile]);

  const handleTemplateFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onRoute("template", file);
    e.target.value = "";
  }, [onRoute]);

  const optionBtn = (icon: string, title: string, desc: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex", alignItems: "flex-start", gap: 10, textAlign: "left",
        width: "100%", padding: "10px 12px", borderRadius: 8,
        background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
        color: "#e0e0e0", cursor: "pointer", fontFamily: "inherit",
      }}
    >
      <span style={{ fontSize: 18, lineHeight: 1 }}>{icon}</span>
      <span>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{desc}</div>
      </span>
    </button>
  );

  return (
    <div
      className="image-upload-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="image-upload-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="image-upload-header">
          <h2>📥 Import</h2>
          <button type="button" className="image-upload-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Drop zone — auto-detects .svg / .psd / .ai / .fig / .html / .htm */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${dragOver ? "#c8b898" : "rgba(255,255,255,0.12)"}`,
              borderRadius: 8, padding: "24px 16px", textAlign: "center", cursor: "pointer",
              background: dragOver ? "rgba(200,184,152,0.08)" : "transparent",
              transition: "border-color 0.15s, background 0.15s",
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".svg,.psd,.ai,.fig,.html,.htm,.json,.png,.jpg,.jpeg"
              style={{ display: "none" }}
              onChange={handleFileInputChange}
            />
            <div style={{ fontSize: 28, marginBottom: 6 }}>📎</div>
            <div style={{ fontSize: 13, color: "#ccc" }}>
              Drop a file here, or click to browse
            </div>
            <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>
              We'll detect what it is — SVG, PSD, AI, FIG, HTML/CSS, or a template JSON
            </div>
          </div>

          {unrecognized && (
            <div style={{
              fontSize: 11, color: "#fbbf24", padding: "8px 10px",
              background: "rgba(251,191,36,0.08)", borderRadius: 6,
              border: "1px solid rgba(251,191,36,0.2)",
            }}>
              ⚠ Couldn't tell what "{unrecognized.name}" is from its extension — pick the right tool below.
            </div>
          )}

          <div style={{ fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 2 }}>
            Or choose manually
          </div>

          {optionBtn("🎨", "SVG / Image", "Add vector shapes or an image into the current frame", () => onRoute("svg"))}
          {optionBtn("🖼", "Design file", "SVG, PSD, AI, FIG, PNG, or JPG → a new frame", () => onRoute("design"))}
          {optionBtn("📋", "HTML / CSS", "Paste, drop, or browse code into a frame", () => onRoute("html"))}
          {optionBtn("📦", "Template JSON", "Restore a full template backup (.json) into this workspace", () => templateFileInputRef.current?.click())}
          <input
            ref={templateFileInputRef}
            type="file"
            accept=".json"
            style={{ display: "none" }}
            onChange={handleTemplateFileChange}
          />
        </div>
      </div>
    </div>
  );
}
