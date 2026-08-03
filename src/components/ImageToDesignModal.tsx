import { useState, useRef, useCallback } from "react";
import { apiFetch } from "../lib/supabase";

interface ImageToDesignModalProps {
  templateId: string;
  frameId: string | null;
  onClose: () => void;
  onDesignReady?: () => void;
}

export function ImageToDesignModal({ templateId, frameId, onClose, onDesignReady }: ImageToDesignModalProps) {
  const [dragOver, setDragOver] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [base64Data, setBase64Data] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [stage, setStage] = useState<"upload" | "converting" | "done">("upload");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      setMessage("Please select an image file (PNG, JPG, WebP)");
      return;
    }
    setMessage("");
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setPreviewUrl(result);
      setBase64Data(result);
      setStage("upload");
    };
    reader.onerror = () => setMessage("Failed to read file");
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [processFile]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) processFile(file);
        break;
      }
    }
  }, [processFile]);

  const handleConvert = async () => {
    if (!base64Data) return;
    setLoading(true);
    setStage("converting");
    setMessage("🤖 AI is analyzing the image and generating HTML/CSS...");

    try {
      const params: Record<string, any> = {
        templateId,
        imageBase64: base64Data,
      };
      if (frameId) params.frameId = frameId;

      const rawRes = await apiFetch<any>("/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "image_to_design",
          params,
          id: 1,
        }),
      });

      // Check JSON-RPC error first
      if (rawRes.error) {
        throw new Error(rawRes.error.message || "MCP error");
      }

      // MCP wraps tool results in { content: [{ type: "text", text: "..." }] }
      const content = rawRes.result?.content?.[0];
      let data = rawRes.result;
      if (content?.type === "text" && content.text) {
        try { data = JSON.parse(content.text); } catch { data = { _raw: content.text }; }
      }

      if (data.error) throw new Error(data.error.message || data.error);

      setStage("done");
      setMessage(`✅ Design generated! (${data.htmlLength || 0}B HTML, ${data.cssLength || 0}B CSS)`);
      onDesignReady?.();
    } catch (e: any) {
      setStage("upload");
      setMessage(`❌ ${e.message || "Conversion failed"}`);
    }
    setLoading(false);
  };

  const handleNewImage = () => {
    setPreviewUrl(null);
    setBase64Data(null);
    setStage("upload");
    setMessage("");
  };

  return (
    <div
      className="image-upload-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onPaste={handlePaste}
      tabIndex={0}
    >
      <div className="image-upload-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="image-upload-header">
          <h2>🪄 Image to Design</h2>
          <button type="button" className="image-upload-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "center" }}>
          {!previewUrl ? (
            <div
              className={`image-upload-dropzone ${dragOver ? "drag-over" : ""}`}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{ width: "100%", minHeight: 200 }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                style={{ display: "none" }}
                onChange={handleFileChange}
              />
              <div className="image-upload-prompt">
                <div style={{ fontSize: 40 }}>🖼️</div>
                <div style={{ fontWeight: 600, marginTop: 8 }}>Drop an image here</div>
                <div style={{ fontSize: 11, opacity: 0.5, marginTop: 4 }}>
                  or click to browse · PNG, JPG, WebP · Ctrl+V to paste
                </div>
              </div>
            </div>
          ) : (
            <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
              <div style={{
                width: "100%", maxHeight: 300, overflow: "hidden",
                borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(255,255,255,0.02)",
              }}>
                <img
                  src={previewUrl}
                  alt="Preview"
                  style={{ width: "100%", height: "auto", display: "block", objectFit: "contain", maxHeight: 280 }}
                />
              </div>

              {stage !== "done" && (
                <button
                  type="button"
                  onClick={handleConvert}
                  disabled={loading}
                  style={{
                    padding: "12px 28px",
                    background: loading
                      ? "linear-gradient(135deg, rgba(200,184,152,0.4), rgba(168,146,106,0.4))"
                      : "linear-gradient(135deg, #c8b898, #a8926a)",
                    color: "#1a1a1a", border: "none", borderRadius: 10,
                    cursor: loading ? "wait" : "pointer",
                    fontSize: 15, fontWeight: 700, fontFamily: "inherit",
                    boxShadow: "0 4px 20px rgba(200,184,152,0.3)",
                    transition: "all 0.2s ease",
                  }}
                >
                  {loading ? "⏳ Converting..." : "🪄 Convert to Design"}
                </button>
              )}

              {stage === "done" && (
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    onClick={handleNewImage}
                    style={{
                      padding: "10px 20px", background: "rgba(255,255,255,0.08)",
                      color: "#ccc", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8,
                      cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "inherit",
                    }}
                  >
                    🆕 New Image
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    style={{
                      padding: "10px 20px", background: "linear-gradient(135deg, #22c55e, #16a34a)",
                      color: "#fff", border: "none", borderRadius: 8,
                      cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "inherit",
                    }}
                  >
                    ✅ Done — View Design
                  </button>
                </div>
              )}
            </div>
          )}

          {loading && (
            <div style={{ width: "100%", height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
              <div style={{
                width: "100%", height: "100%",
                background: "linear-gradient(90deg, #c8b898, #a8926a, #c8b898)",
                backgroundSize: "200% 100%",
                animation: "shimmer 1.5s infinite",
                borderRadius: 2,
              }} />
            </div>
          )}

          {message && (
            <div style={{
              fontSize: 13, fontWeight: 500,
              color: message.startsWith("✅") ? "#4ade80" : message.startsWith("❌") ? "#f87171" : "#fbbf24",
              padding: "10px 16px", background: "rgba(255,255,255,0.05)", borderRadius: 8,
              width: "100%", textAlign: "center",
            }}>
              {message}
            </div>
          )}

          <div style={{ fontSize: 10, color: "#555", textAlign: "center", maxWidth: 360 }}>
            Powered by Gemini Vision. The AI analyzes your image and generates editable HTML/CSS that you can refine in the editor.
          </div>
        </div>
      </div>
    </div>
  );
}
