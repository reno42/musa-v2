import { useState, useCallback, useEffect } from "react";
import { apiFetch } from "../lib/supabase";
import { imageStorageWarning } from "../lib/storageHealth";

export interface RasterImageImport {
  name: string;
  dataUrl: string;
  width: number;
  height: number;
}

interface Props {
  workspaceId: string;
  onImported: (templateId: string) => void;
  onRasterImported: (image: RasterImageImport) => void;
  onClose: () => void;
  /** Pre-load a file chosen elsewhere (e.g. the unified Import router) so
   *  the user doesn't have to pick it again. */
  initialFile?: File | null;
}

const overlayStyle: React.CSSProperties = {
  position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
  background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center",
  justifyContent: "center", zIndex: 10000,
};
const dialogStyle: React.CSSProperties = {
  background: "rgba(24,24,48,0.95)", borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.08)", padding: 24,
  width: 520, maxHeight: "80vh", overflow: "auto",
  color: "#e0e0e0", fontFamily: "Inter, system-ui, sans-serif",
};
const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: "8px 16px", cursor: "pointer", borderBottom: active ? "2px solid #8B5CF6" : "2px solid transparent",
  color: active ? "#fff" : "#888", fontSize: 13, fontWeight: 600,
});

type ImportMode = "svg" | "raster";

function isRasterFile(file: File): boolean {
  return /\.(jpg|jpeg|png)$/i.test(file.name)
    || file.type === "image/jpeg"
    || file.type === "image/png";
}

export function SvgImportDialog({ workspaceId, onImported, onRasterImported, onClose, initialFile }: Props) {
  const [tab, setTab] = useState<"upload" | "paste">("upload");
  const [svgCode, setSvgCode] = useState("");
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [storageWarning, setStorageWarning] = useState("");
  const [preview, setPreview] = useState("");
  const [importMode, setImportMode] = useState<ImportMode>("svg");
  const [rasterDataUrl, setRasterDataUrl] = useState<string | null>(null);
  const [rasterDimensions, setRasterDimensions] = useState({ width: 0, height: 0 });
  const [saveAsAsset, setSaveAsAsset] = useState(false);

  const processFile = useCallback((file: File) => {
    if (isRasterFile(file)) {
      setStorageWarning(imageStorageWarning(file) || "");
      setRasterDimensions({ width: 0, height: 0 });
      // ── Raster path: JPG/PNG → read as data URL ──
      setImportMode("raster");
      setFileName(file.name.replace(/\.[^.]+$/, ""));
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        setRasterDataUrl(dataUrl);
        setPreview(`<img src="${dataUrl}" style="max-width:100%;height:auto;" />`);
        setSvgCode("");
        const image = new Image();
        image.onload = () => setRasterDimensions({
          width: image.naturalWidth,
          height: image.naturalHeight,
        });
        image.src = dataUrl;
      };
      reader.onerror = () => setError("Failed to read image file");
      reader.readAsDataURL(file);
    } else {
      setStorageWarning("");
      // ── SVG path: read as text ──
      setImportMode("svg");
      setFileName(file.name.replace(/\.svg$/i, ""));
      const reader = new FileReader();
      reader.onload = () => {
        const svg = reader.result as string;
        setSvgCode(svg);
        setRasterDataUrl(null);
        setRasterDimensions({ width: 0, height: 0 });
        setPreview(svg);
      };
      reader.onerror = () => setError("Failed to read SVG file");
      reader.readAsText(file);
    }
  }, []);

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  useEffect(() => {
    if (initialFile) processFile(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  const handlePasteChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setSvgCode(v);
    setImportMode("svg");
    setRasterDataUrl(null);
    setPreview(v);
    const nameMatch = v.match(/<title[^>]*>([^<]*)<\/title>/);
    if (nameMatch) setFileName(nameMatch[1].replace(/\.[^.]+$/, ""));
  }, []);

  // Also save the imported file into the workspace's Asset library — same
  // /assets/upload endpoint the Assets modal uses, so it shows up there too.
  const saveToAssetLibrary = useCallback(async (dataUrl: string, name: string) => {
    try {
      await apiFetch("/assets/upload", {
        method: "POST",
        body: JSON.stringify({ name, data: dataUrl, workspaceId }),
      });
    } catch (e) {
      console.error("[Import] Save as asset failed:", e);
    }
  }, [workspaceId]);

  const handleImport = useCallback(async () => {
    // For raster mode, require rasterDataUrl; for SVG mode, require svgCode
    if (importMode === "svg" && !svgCode.trim()) return;
    if (importMode === "raster" && !rasterDataUrl) return;

    setLoading(true);
    setError("");
    try {
      const name = fileName || (importMode === "raster" ? "Imported Image" : "Imported SVG");

      if (saveAsAsset) {
        const assetDataUrl = importMode === "raster" && rasterDataUrl
          ? rasterDataUrl
          : `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgCode)))}`;
        await saveToAssetLibrary(assetDataUrl, name);
      }

      if (importMode === "raster" && rasterDataUrl) {
        onRasterImported({
          name,
          dataUrl: rasterDataUrl,
          width: rasterDimensions.width,
          height: rasterDimensions.height,
        });
        onClose();
      } else {
        // ── SVG import: use import_svg MCP tool ──
        const res = await apiFetch<any>("/mcp", {
          method: "POST",
          body: JSON.stringify({
            jsonrpc: "2.0", method: "import_svg",
            params: { workspaceId, svg: svgCode, name },
            id: 0,
          }),
        });
        if (res.result?.templateId) {
          onImported(res.result.templateId);
        } else {
          const msg = res.error?.message || "Import failed";
          console.error("[Import] SVG import failed:", res.error || res);
          setError(msg);
        }
      }
    } catch (err: any) {
      console.error("[Import] Error:", err);
      setError(err.message || "Import failed");
    }
    setLoading(false);
  }, [svgCode, rasterDataUrl, rasterDimensions, importMode, fileName, workspaceId, onImported, onRasterImported, onClose, saveAsAsset, saveToAssetLibrary]);

  const canImport = importMode === "raster"
    ? Boolean(rasterDataUrl && rasterDimensions.width > 0 && rasterDimensions.height > 0)
    : Boolean(svgCode.trim());

  return (
    <div style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={dialogStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Import Image / SVG</h3>
          <button type="button" onClick={onClose} aria-label="Close import dialog" style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>

        <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
          <div style={tabStyle(tab === "upload")} onClick={() => setTab("upload")}>Upload File</div>
          <div style={tabStyle(tab === "paste")} onClick={() => setTab("paste")}>Paste Code</div>
        </div>

        {tab === "upload" ? (
          <div>
            <input type="file" accept=".svg,.jpg,.jpeg,.png,image/svg+xml,image/jpeg,image/png" onChange={handleFile}
              style={{ display: "block", width: "100%", padding: "40px 20px", textAlign: "center",
                border: "2px dashed rgba(255,255,255,0.12)", borderRadius: 8, cursor: "pointer",
                color: "#888", fontSize: 13 }} />
            <div style={{ fontSize: 10, color: "#666", marginTop: 6, textAlign: "center" }}>
              Supports SVG, JPG, and PNG files
            </div>
          </div>
        ) : (
          <textarea
            value={svgCode}
            onChange={handlePasteChange}
            placeholder="Paste SVG code here..."
            style={{
              width: "100%", height: 160, background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6,
              color: "#e0e0e0", fontSize: 12, fontFamily: "monospace",
              padding: 12, resize: "vertical", outline: "none",
            }}
          />
        )}

        {fileName && (
          <div style={{ marginTop: 12 }}>
            <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>
              {importMode === "raster" ? "Image Name" : "Template Name"}
            </label>
            <input value={fileName} onChange={e => setFileName(e.target.value)}
              style={{ width: "100%", padding: "8px 12px", background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.08)", borderRadius: 4,
                color: "#e0e0e0", fontSize: 13, outline: "none" }} />
          </div>
        )}

        {preview && (
          <div style={{ marginTop: 16, background: "#fff", borderRadius: 8, padding: 12, maxHeight: 200, overflow: "auto" }}>
            <div dangerouslySetInnerHTML={{ __html: preview }} style={{ maxWidth: "100%" }} />
          </div>
        )}

        {error && <div style={{ color: "#EF4444", fontSize: 12, marginTop: 8 }}>{error}</div>}

        {storageWarning && (
          <div role="alert" style={{ color: "#fbbf24", fontSize: 12, marginTop: 8 }}>
            {storageWarning}
          </div>
        )}

        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, cursor: "pointer" }}>
          <input type="checkbox" checked={saveAsAsset} onChange={e => setSaveAsAsset(e.target.checked)} />
          <span style={{ fontSize: 11, color: "#aaa" }}>
            💾 Guardar también como Asset (recomendado para logos y patrones de marca)
          </span>
        </label>

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button onClick={onClose}
            style={{ flex: 1, padding: "10px 16px", background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6,
              color: "#888", cursor: "pointer", fontSize: 13 }}>
            Cancel
          </button>
          <button onClick={handleImport} disabled={!canImport || loading}
            style={{ flex: 1, padding: "10px 16px", background: canImport ? "#8B5CF6" : "rgba(255,255,255,0.04)",
              border: "none", borderRadius: 6, color: "#fff", cursor: canImport ? "pointer" : "default",
              fontSize: 13, fontWeight: 600, opacity: loading ? 0.6 : 1 }}>
            {loading ? "Importing..." : `Import ${importMode === "raster" ? "Image" : "SVG"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
