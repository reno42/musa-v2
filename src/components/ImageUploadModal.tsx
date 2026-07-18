import { useState, useRef, useCallback } from "react";
import { imageStorageWarning } from "../lib/storageHealth";
import { getApiHeaders } from "../lib/apiKey";

interface Asset {
  id: string;
  name: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  width?: number;
  height?: number;
  tags?: string[];
  workspaceId?: string;
  createdAt?: string;
}

interface ImageUploadModalProps {
  onClose: () => void;
  onAssetUploaded?: (asset: Asset) => void;
}

const API_BASE = "/api";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

async function apiFetch<T = any>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: getApiHeaders(),
    ...options,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

export function ImageUploadModal({ onClose, onAssetUploaded }: ImageUploadModalProps) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<Asset[]>([]);
  const [error, setError] = useState("");
  const [storageWarning, setStorageWarning] = useState("");
  const [assetsList, setAssetsList] = useState<Asset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [showAssets, setShowAssets] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadAssets = useCallback(async () => {
    setLoadingAssets(true);
    try {
      const data = await apiFetch<{ assets: Asset[] }>("/assets");
      setAssetsList(data.assets || []);
    } catch {
      setAssetsList([]);
    }
    setLoadingAssets(false);
  }, []);

  const uploadFile = useCallback(async (file: File) => {
    const warning = imageStorageWarning(file);
    setStorageWarning(warning || "");
    if (warning && !window.confirm(`${warning}\n\n¿Deseas continuar con la carga?`)) return;
    setError("");
    setUploading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const result = await apiFetch<{
        assetId: string;
        name: string;
        url: string;
        mimeType: string;
        sizeBytes: number;
      }>("/assets/upload", {
        method: "POST",
        body: JSON.stringify({
          name: file.name.replace(/\.[^.]+$/, ""),
          data: base64,
        }),
      });

      const asset: Asset = {
        id: result.assetId,
        name: result.name,
        filename: file.name,
        mimeType: result.mimeType,
        sizeBytes: result.sizeBytes,
        url: result.url,
      };

      setUploaded(prev => [asset, ...prev]);
      onAssetUploaded?.(asset);
      setPreviewUrl(result.url);
    } catch (e: any) {
      setError(e.message || "Upload failed");
    }
    setUploading(false);
  }, [onAssetUploaded]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        uploadFile(file);
      } else {
        setError(`Skipped non-image file: ${file.name}`);
      }
    }
  }, [uploadFile]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      uploadFile(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [uploadFile]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) uploadFile(file);
      }
    }
  }, [uploadFile]);

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url).then(() => {
      setError("");
    }).catch(() => {
      setError("Failed to copy URL");
    });
  };

  return (
    <div
      className="image-upload-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onPaste={handlePaste}
      tabIndex={0}
    >
      <div className="image-upload-modal" onClick={e => e.stopPropagation()}>
        <div className="image-upload-header">
          <h2>📷 Upload Images</h2>
          <button type="button" className="image-upload-close" onClick={onClose} aria-label="Close image upload">✕</button>
        </div>

        <div
          className={`image-upload-dropzone ${dragOver ? "drag-over" : ""}`}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml,image/webp"
            multiple
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
          {uploading ? (
            <div className="image-upload-status">⏳ Uploading...</div>
          ) : (
            <div className="image-upload-prompt">
              <div style={{ fontSize: 32 }}>📁</div>
              <div>Drag & drop images here or click to browse</div>
              <div style={{ fontSize: 11, opacity: 0.5, marginTop: 4 }}>
                PNG, JPG, SVG, WebP — max 10MB each. Ctrl+V to paste.
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="image-upload-error">{error}</div>
        )}

        {storageWarning && (
          <div className="image-upload-error" role="alert" style={{ color: "#fbbf24", borderColor: "rgba(251,191,36,0.3)" }}>
            {storageWarning}
          </div>
        )}

        {previewUrl && (
          <div className="image-upload-preview">
            <img src={previewUrl} alt="Preview" style={{ maxWidth: "100%", maxHeight: 120 }} />
          </div>
        )}

        {uploaded.length > 0 && (
          <div className="image-upload-results">
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Uploaded ({uploaded.length}):</div>
            {uploaded.map(a => (
              <div key={a.id} className="image-upload-result-item">
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {a.name} — {formatSize(a.sizeBytes)}
                </span>
                <button
                  type="button"
                  className="image-upload-copy-btn"
                  onClick={() => copyUrl(a.url)}
                  title="Copy URL"
                >
                  📋
                </button>
                <a href={a.url} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 4 }}>🔗</a>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            className="image-upload-list-btn"
            onClick={() => { setShowAssets(!showAssets); if (!showAssets) loadAssets(); }}
          >
            {showAssets ? "Hide" : "Browse"} All Assets
          </button>
        </div>

        {showAssets && (
          <div className="image-upload-assets-list">
            {loadingAssets ? (
              <div style={{ padding: 8, opacity: 0.5 }}>Loading...</div>
            ) : assetsList.length === 0 ? (
              <div style={{ padding: 8, opacity: 0.5 }}>No assets uploaded yet</div>
            ) : (
              assetsList.map(a => (
                <div key={a.id} className="image-upload-asset-item">
                  <img
                    src={a.url}
                    alt={a.name}
                    style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 4 }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginLeft: 8 }}>
                    {a.name}
                  </span>
                  <button
                    type="button"
                    className="image-upload-copy-btn"
                    onClick={() => copyUrl(a.url)}
                    title="Copy URL"
                  >
                    📋
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        <div className="image-upload-footer">
          <button type="button" className="editor-v2-btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
