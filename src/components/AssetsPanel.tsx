import { useState, useRef, useCallback, useEffect } from "react";
import { imageStorageWarning } from "../lib/storageHealth";
import { prepareImageForUpload } from "../lib/imageCompress";
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

interface StorageSummary {
  totalBytes: number;
  totalFiles: number;
  buckets: Array<{ name: string; label: string; sizeBytes: number }>;
  trash: { templates: number; assets: number; total: number };
}

interface AssetsPanelProps {
  workspaceId: string;
  onAssetUploaded?: (asset: Asset) => void;
  /** Opens Dashboard → Storage (quota + trash management) — the editor has
   *  no room for a full trash UI, so this just routes there. */
  onManageStorage?: () => void;
  /** src of the currently selected element, if it's an <img> — enables
   *  "save selection as asset". Data URLs upload directly; http(s) URLs
   *  (e.g. an AI-placed hyperlinked image) are fetched and re-uploaded so
   *  they become a real owned asset instead of a link to someone else's
   *  server. */
  selectedImageSrc?: string | null;
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

export function AssetsPanel({ workspaceId, onAssetUploaded, onManageStorage, selectedImageSrc }: AssetsPanelProps) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savingSelection, setSavingSelection] = useState(false);
  const [error, setError] = useState("");
  const [storageWarning, setStorageWarning] = useState("");
  const [assetsList, setAssetsList] = useState<Asset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(true);
  const [storageSummary, setStorageSummary] = useState<StorageSummary | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    apiFetch<{ success: boolean; data: StorageSummary }>(`/storage/summary?workspaceId=${encodeURIComponent(workspaceId)}`)
      .then(res => { if (res.success) setStorageSummary(res.data); })
      .catch(() => { /* quota display is best-effort */ });
  }, [workspaceId]);

  const loadAssets = useCallback(async () => {
    setLoadingAssets(true);
    try {
      const data = await apiFetch<{ assets: Asset[] }>(`/assets?workspaceId=${encodeURIComponent(workspaceId)}`);
      setAssetsList(data.assets || []);
    } catch {
      setAssetsList([]);
    }
    setLoadingAssets(false);
  }, [workspaceId]);

  useEffect(() => { loadAssets(); }, [loadAssets]);

  const uploadDataUrl = useCallback(async (name: string, dataUrl: string) => {
    const result = await apiFetch<{ assetId: string; name: string; url: string; mimeType: string; sizeBytes: number }>("/assets/upload", {
      method: "POST",
      body: JSON.stringify({ name, data: dataUrl, workspaceId }),
    });
    const asset: Asset = {
      id: result.assetId, name: result.name, filename: name,
      mimeType: result.mimeType, sizeBytes: result.sizeBytes, url: result.url,
    };
    setAssetsList(prev => [asset, ...prev]);
    onAssetUploaded?.(asset);
    return asset;
  }, [onAssetUploaded, workspaceId]);

  const uploadFile = useCallback(async (file: File) => {
    setError("");
    setUploading(true);
    try {
      // Shrunk before anything is asked of the user. The old flow measured the
      // original and warned that it was heavy — which put the problem on the
      // person holding a phone photo, who had no way to fix it. Now it is
      // fixed here, and the warning only survives for what stays big after.
      const { dataUrl: base64, bytes, note } = await prepareImageForUpload(file);
      setStorageWarning(bytes > file.size * 0.95 ? imageStorageWarning(file) || "" : note);
      await uploadDataUrl(file.name.replace(/\.[^.]+$/, ""), base64);
    } catch (e: any) {
      setError(e.message || "Upload failed");
    }
    setUploading(false);
  }, [uploadDataUrl]);

  // ── Save the currently selected image (canvas selection) as an asset ──
  const handleSaveSelectionAsAsset = useCallback(async () => {
    if (!selectedImageSrc) return;
    setError("");
    setSavingSelection(true);
    try {
      let dataUrl = selectedImageSrc;
      if (!dataUrl.startsWith("data:")) {
        // Remote/hyperlinked image (e.g. one an AI placed via URL) — fetch
        // it and re-upload so it becomes a real asset in our own bucket
        // instead of just a link to someone else's server.
        const resp = await fetch(selectedImageSrc);
        const blob = await resp.blob();
        dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }
      await uploadDataUrl("Selected image", dataUrl);
    } catch (e: any) {
      setError(e.message || "Could not save selection as asset");
    }
    setSavingSelection(false);
  }, [selectedImageSrc, uploadDataUrl]);

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

  const btnStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.08)", color: "#ccc",
    border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6,
    padding: "8px 14px", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
  };

  return (
    <div
      style={{ height: "100%", overflow: "auto", padding: 12, color: "#e0e0e0", fontSize: 13 }}
      onPaste={handlePaste}
      tabIndex={0}
    >
      {storageSummary && (
        <div style={{
          display: "flex", flexDirection: "column", gap: 2,
          fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 10,
        }}>
          <span>{formatSize(storageSummary.totalBytes)} usados · {storageSummary.totalFiles} archivos en tu workspace</span>
          {onManageStorage && (
            <button
              type="button"
              onClick={onManageStorage}
              style={{
                background: "none", border: "none", color: "rgba(255,255,255,0.5)",
                fontSize: 11, cursor: "pointer", textDecoration: "underline", padding: 0, alignSelf: "flex-start",
              }}
            >
              🗑️ Gestionar espacio / papelera
            </button>
          )}
        </div>
      )}

      {/* Save the current canvas selection (an image) as a reusable asset */}
      <button
        type="button"
        onClick={handleSaveSelectionAsAsset}
        disabled={!selectedImageSrc || savingSelection}
        style={{
          ...btnStyle, width: "100%", fontWeight: 600, marginBottom: 4,
          background: selectedImageSrc ? "rgba(200,184,152,0.2)" : "rgba(255,255,255,0.04)",
          borderColor: selectedImageSrc ? "rgba(200,184,152,0.3)" : "rgba(255,255,255,0.08)",
          color: selectedImageSrc ? "#e0e0e0" : "#666",
          cursor: selectedImageSrc ? "pointer" : "not-allowed",
        }}
      >
        {savingSelection ? "⏳ Guardando..." : "➕ Guardar selección como Asset"}
      </button>
      <div style={{ fontSize: 10, color: "#666", marginBottom: 12, lineHeight: 1.5 }}>
        {selectedImageSrc
          ? "Se guardará como PNG en tu Assets Library, reutilizable en cualquier diseño."
          : "Selecciona una imagen en el lienzo para guardarla aquí como asset reusable."}
      </div>

      {/* Upload dropzone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? "#c8b898" : "rgba(255,255,255,0.15)"}`,
          borderRadius: 8, padding: 18, textAlign: "center", cursor: "pointer",
          marginBottom: 12, transition: "border 0.15s",
          background: dragOver ? "rgba(200,184,152,0.06)" : "transparent",
        }}
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
          <div style={{ fontSize: 12, color: "#888" }}>⏳ Uploading...</div>
        ) : (
          <div>
            <div style={{ fontSize: 24, marginBottom: 4 }}>📁</div>
            <div style={{ fontSize: 12, color: "#888" }}>
              Drag & drop images here or click to browse
            </div>
            <div style={{ fontSize: 10, opacity: 0.6, marginTop: 4 }}>
              PNG, JPG, SVG, WebP — max 5MB each. Ctrl+V to paste.
            </div>
          </div>
        )}
      </div>

      {error && (
        <div style={{ fontSize: 11, color: "#f87171", marginBottom: 8 }}>{error}</div>
      )}
      {storageWarning && (
        <div role="alert" style={{ fontSize: 11, color: "#fbbf24", marginBottom: 8 }}>{storageWarning}</div>
      )}

      {/* Library: everything saved to this workspace's bucket */}
      <div style={{ fontSize: 11, fontWeight: 600, color: "#999", marginBottom: 8, marginTop: 4 }}>
        📚 Tu biblioteca ({assetsList.length})
      </div>
      {loadingAssets ? (
        <div style={{ padding: 8, opacity: 0.5, fontSize: 12 }}>Loading...</div>
      ) : assetsList.length === 0 ? (
        <div style={{ padding: 8, opacity: 0.5, fontSize: 12 }}>No assets uploaded yet</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(70px, 1fr))", gap: 8 }}>
          {assetsList.map(a => (
            <div key={a.id} style={{ position: "relative" }}>
              <img
                src={a.url}
                alt={a.name}
                title={a.name}
                style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 6, border: "1px solid rgba(255,255,255,0.08)" }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
              <button
                type="button"
                onClick={() => copyUrl(a.url)}
                title="Copy URL"
                style={{
                  position: "absolute", bottom: 2, right: 2,
                  background: "rgba(0,0,0,0.6)", border: "none", borderRadius: 4,
                  color: "#fff", fontSize: 10, cursor: "pointer", padding: "1px 4px",
                }}
              >
                📋
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
