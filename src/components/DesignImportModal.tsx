import { useState, useCallback, useRef, useEffect } from "react";
import { importDesignFile, SUPPORTED_IMPORT_FORMATS, type ImportResult } from "../lib/designImport";
import { getApiHeaders } from "../lib/apiKey";

interface DesignImportModalProps {
  open: boolean;
  onClose: () => void;
  onImport: (result: ImportResult) => void;
  /** Pre-load files chosen elsewhere (e.g. the unified Import router) so
   *  the user doesn't have to pick them again. */
  initialFiles?: File[] | null;
  /** Needed only to also save imported files into the Asset library. */
  workspaceId?: string;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Design Import Modal — accepts .svg, .psd, .ai, .fig, .png, .jpg files
 * and converts them into Futuraria frames.
 */
export function DesignImportModal({ open, onClose, onImport, initialFiles, workspaceId }: DesignImportModalProps) {
  const [dragOver, setDragOver] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveAsAsset, setSaveAsAsset] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;
    setProcessing(true);
    setError(null);
    try {
      for (const file of fileArray) {
        const result = await importDesignFile(file);
        await onImport(result);
        // Best-effort: only works for actual image files (SVG/PNG/JPG) —
        // the backend rejects non-"image/*" data URLs, so PSD/AI/FIG just
        // silently skip this without blocking the import itself.
        if (saveAsAsset && workspaceId) {
          try {
            const dataUrl = await fileToDataUrl(file);
            await fetch("/api/assets/upload", {
              method: "POST",
              headers: { ...getApiHeaders(), "Content-Type": "application/json" },
              body: JSON.stringify({ name: result.name || file.name, data: dataUrl, workspaceId }),
            });
          } catch (e) {
            console.error("[Import] Save as asset failed:", e);
          }
        }
      }
      onClose();
    } catch (err: any) {
      setError(err?.message || "Error al importar el archivo");
    } finally {
      setProcessing(false);
    }
  }, [onImport, onClose, saveAsAsset, workspaceId]);

  useEffect(() => {
    if (open && initialFiles && initialFiles.length > 0) handleFiles(initialFiles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialFiles]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--editor-bg-2, #16162a)",
          borderRadius: 12,
          padding: 24,
          maxWidth: 560,
          width: "90%",
          border: "1px solid var(--editor-border, #333346)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--editor-text, #e0e0f0)" }}>
            Importar diseño
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none", border: "none", color: "var(--editor-text-dim, #888)",
              cursor: "pointer", fontSize: 18, padding: 4,
            }}
          >
            ×
          </button>
        </div>

        {/* Drop zone */}
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? "var(--editor-accent, #6c5ce7)" : "var(--editor-border, #333346)"}`,
            borderRadius: 8,
            padding: "32px 20px",
            textAlign: "center",
            cursor: "pointer",
            transition: "border-color 0.15s, background 0.15s",
            background: dragOver ? "rgba(108,92,231,0.08)" : "transparent",
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={SUPPORTED_IMPORT_FORMATS}
            multiple
            style={{ display: "none" }}
            onChange={e => { if (e.target.files) handleFiles(e.target.files); }}
          />
          {processing ? (
            <div style={{ color: "var(--editor-accent, #6c5ce7)", fontSize: 14 }}>
              Procesando...
            </div>
          ) : (
            <>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📎</div>
              <div style={{ color: "var(--editor-text, #e0e0f0)", fontSize: 14, marginBottom: 4 }}>
                Arrastra tus archivos aquí o haz clic para seleccionar
              </div>
              <div style={{ color: "var(--editor-text-dim, #888)", fontSize: 12 }}>
                SVG · PSD (Photoshop) · AI (Illustrator) · FIG (Figma) · PNG · JPG
              </div>
            </>
          )}
        </div>

        {error && (
          <div style={{
            marginTop: 12,
            padding: "10px 14px",
            background: "rgba(255,80,80,0.1)",
            border: "1px solid rgba(255,80,80,0.3)",
            borderRadius: 6,
            color: "#ff6464",
            fontSize: 12,
          }}>
            {error}
          </div>
        )}

        {workspaceId && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, cursor: "pointer" }}>
            <input type="checkbox" checked={saveAsAsset} onChange={e => setSaveAsAsset(e.target.checked)} />
            <span style={{ fontSize: 11, color: "var(--editor-text-dim, #888)" }}>
              💾 Guardar también como Asset (recomendado para logos y patrones de marca — solo funciona con SVG/PNG/JPG)
            </span>
          </label>
        )}

        {/* Format guide */}
        <div style={{ marginTop: 16, fontSize: 11, color: "var(--editor-text-dim, #888)", lineHeight: 1.6 }}>
          <strong style={{ color: "var(--editor-text, #e0e0f0)" }}>Compatibilidad:</strong><br />
          ✓ <strong>SVG</strong> — Importación vectorial completa<br />
          ✓ <strong>PSD</strong> — Capas de Photoshop → elementos HTML posicionados<br />
          ✓ <strong>AI</strong> — Vista previa raster (para vector, exportar como SVG primero)<br />
          ⚠ <strong>FIG</strong> — Formato propietario, usar export SVG desde Figma<br />
          ✓ <strong>PNG/JPG</strong> — Imagen como frame completo
        </div>
      </div>
    </div>
  );
}
