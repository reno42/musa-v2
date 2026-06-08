import { useState, useRef, useEffect } from "react";

interface ImageEntry {
  url: string;
  caption?: string;
}

interface GalleryDropdownProps {
  templateId: string | null;
  onGalleryCreate: (params: {
    images: ImageEntry[];
    columns: number;
    imageWidth: number;
    imageHeight: number;
    gap: number;
    x: number;
    y: number;
  }) => void;
}

export function GalleryDropdown({ templateId, onGalleryCreate }: GalleryDropdownProps) {
  const [open, setOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Form state
  const [urlsText, setUrlsText] = useState("");
  const [columns, setColumns] = useState(3);
  const [gap, setGap] = useState(12);
  const [imageWidth, setImageWidth] = useState(200);
  const [imageHeight, setImageHeight] = useState(200);
  const [startX, setStartX] = useState(100);
  const [startY, setStartY] = useState(100);
  const [withCaptions, setWithCaptions] = useState(false);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close modal on outside click
  useEffect(() => {
    if (!modalOpen) return;
    const handler = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) setModalOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [modalOpen]);

  const handleSubmit = () => {
    const lines = urlsText
      .split("\n")
      .map(l => l.trim())
      .filter(l => l.length > 0);

    if (lines.length === 0) return;

    const images: ImageEntry[] = lines.map(url => ({
      url,
      caption: withCaptions ? "" : undefined,
    }));

    onGalleryCreate({
      images,
      columns: Math.max(1, Math.min(6, columns)),
      imageWidth: Math.max(50, imageWidth),
      imageHeight: Math.max(50, imageHeight),
      gap: Math.max(0, gap),
      x: startX,
      y: startY,
    });

    setModalOpen(false);
    setOpen(false);
  };

  const imageCount = urlsText.split("\n").filter(l => l.trim()).length;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        className="tool-btn"
        onClick={() => setOpen(p => !p)}
        title="Image Gallery"
        aria-label="Image Gallery"
      >
        <svg viewBox="0 0 24 24" width="18" height="18">
          <rect x="2" y="2" width="8" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <rect x="14" y="2" width="8" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <rect x="2" y="14" width="8" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <rect x="14" y="14" width="8" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            left: 48,
            top: 0,
            background: "#16161e",
            border: "1px solid #2a2a3a",
            borderRadius: 8,
            padding: "4px 0",
            minWidth: 140,
            zIndex: 100,
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          }}
        >
          <button
            type="button"
            onClick={() => { setModalOpen(true); setOpen(false); }}
            style={{
              display: "block", width: "100%", padding: "6px 12px",
              border: "none", background: "transparent", color: "#c4c0b4",
              cursor: "pointer", fontSize: 12, textAlign: "left",
            }}
          >
            🖼 Create Gallery...
          </button>
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 200,
        }}>
          <div ref={modalRef} style={{
            background: "#16161e", border: "1px solid #2a2a3a",
            borderRadius: 12, padding: "16px 20px",
            width: 440, maxHeight: "90vh", overflowY: "auto",
            boxShadow: "0 16px 48px rgba(0,0,0,0.6)",
            fontFamily: "Inter, sans-serif", fontSize: 12, color: "#c4c0b4",
          }}>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              marginBottom: 14,
            }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>🖼 Image Gallery</span>
              <button type="button" onClick={() => setModalOpen(false)}
                style={{ background: "none", border: "none", color: "#7a7668", cursor: "pointer", fontSize: 16 }}>
                ✕
              </button>
            </div>

            {/* URLs */}
            <label style={labelStyle}>Image URLs (one per line) {imageCount > 0 && `— ${imageCount} images`}</label>
            <textarea
              value={urlsText}
              onChange={e => setUrlsText(e.target.value)}
              placeholder={"https://example.com/image1.jpg\nhttps://example.com/image2.jpg\nhttps://example.com/image3.jpg"}
              rows={5}
              style={textareaStyle}
            />

            {/* Grid settings */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px", marginTop: 12 }}>
              <div>
                <label style={labelStyle}>Columns (1-6)</label>
                <input type="number" min={1} max={6} value={columns}
                  onChange={e => setColumns(Number(e.target.value))}
                  style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Gap (px)</label>
                <input type="number" min={0} value={gap}
                  onChange={e => setGap(Number(e.target.value))}
                  style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Image Width (px)</label>
                <input type="number" min={50} value={imageWidth}
                  onChange={e => setImageWidth(Number(e.target.value))}
                  style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Image Height (px)</label>
                <input type="number" min={50} value={imageHeight}
                  onChange={e => setImageHeight(Number(e.target.value))}
                  style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Start X</label>
                <input type="number" value={startX}
                  onChange={e => setStartX(Number(e.target.value))}
                  style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Start Y</label>
                <input type="number" value={startY}
                  onChange={e => setStartY(Number(e.target.value))}
                  style={inputStyle} />
              </div>
            </div>

            {/* Caption toggle */}
            <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 6, marginTop: 12 }}>
              <input type="checkbox" checked={withCaptions} onChange={e => setWithCaptions(e.target.checked)}
                style={{ accentColor: "#c8b898" }} />
              Enable image captions
            </label>

            {/* Preview info */}
            {imageCount > 0 && (
              <div style={{
                marginTop: 10, padding: "8px 10px", background: "#0a0a14",
                borderRadius: 6, fontSize: 10, color: "#7a7668",
                border: "1px solid #1c1c26",
              }}>
                Grid: {imageCount} images, {Math.min(columns, imageCount)} col(s) × {Math.ceil(imageCount / columns)} row(s)
                {" · "}Total: {Math.min(columns, imageCount) * imageWidth + (Math.min(columns, imageCount) - 1) * gap}px wide
              </div>
            )}

            {/* Submit */}
            <button type="button" onClick={handleSubmit}
              disabled={imageCount === 0 || !templateId}
              style={{
                ...btnPrimary, marginTop: 14, width: "100%",
                opacity: imageCount === 0 || !templateId ? 0.5 : 1,
              }}>
              Create Gallery ({imageCount} images)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 10, color: "#7a7668",
  marginBottom: 3, textTransform: "uppercase", letterSpacing: 1,
};

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box",
  padding: "5px 8px", borderRadius: 4,
  background: "#0a0a14", border: "1px solid #2a2a3a",
  color: "#f0ebe0", fontSize: 11, outline: "none",
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: "vertical", minHeight: 80,
  fontFamily: "monospace",
};

const btnPrimary: React.CSSProperties = {
  padding: "8px 14px", borderRadius: 6,
  background: "#1a2a1a", border: "1px solid #2a4a2a",
  color: "#4ade80", fontSize: 12, fontWeight: 600,
  cursor: "pointer",
};
