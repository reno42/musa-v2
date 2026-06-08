import { useState, useRef, useEffect } from "react";

type EmbedType = "video" | "audio" | "pdf" | "figma" | "social";

interface EmbedsDropdownProps {
  onEmbed: (url: string, type: EmbedType) => void;
}

const embedOptions: { type: EmbedType; label: string; icon: string }[] = [
  { type: "video", label: "🎬 Video (YouTube/Vimeo)", icon: "▶" },
  { type: "audio", label: "🎵 Audio (SoundCloud)", icon: "♫" },
  { type: "pdf", label: "📄 PDF Document", icon: "📄" },
  { type: "figma", label: "⬡ Figma Frame", icon: "⬡" },
  { type: "social", label: "🐦 Social (Twitter/GitHub)", icon: "@" },
];

export function EmbedsDropdown({ onEmbed }: EmbedsDropdownProps) {
  const [open, setOpen] = useState(false);
  const [urlModal, setUrlModal] = useState<EmbedType | null>(null);
  const [url, setUrl] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open && !urlModal) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        setUrlModal(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, urlModal]);

  const handleSelect = (type: EmbedType) => {
    setUrlModal(type);
    setUrl("");
    setOpen(false);
  };

  const handleSubmit = () => {
    if (urlModal && url.trim()) {
      onEmbed(url.trim(), urlModal);
      setUrlModal(null);
      setUrl("");
    }
  };

  return (
    <div className="align-dropdown-wrapper" ref={wrapperRef}>
      <button
        type="button"
        className="tool-btn has-submenu"
        onClick={() => setOpen(!open)}
        title="Embed content" aria-label="Embed content"
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <rect x="2" y="3" width="20" height="18" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10 9l-4 3 4 3V9zM14 15l4-3-4-3v6z" fill="currentColor" opacity="0.6" />
        </svg>
        <span className="corner-marker">
          <svg viewBox="0 0 6 6"><path d="M0 6L6 6L6 0Z" fill="currentColor" opacity="0.6" /></svg>
        </span>
      </button>

      {/* Dropdown menu */}
      {open && (
        <div className="align-dropdown" style={{ top: -4 }}>
          <div className="align-dropdown-section">
            <span className="align-dropdown-label">Embed</span>
            <div className="align-dropdown-row" style={{ flexDirection: "column", gap: 2 }}>
              {embedOptions.map(opt => (
                <button
                  key={opt.type}
                  type="button"
                  onClick={() => handleSelect(opt.type)}
                  style={{
                    background: "none", border: "none", color: "#c4c4d4",
                    padding: "4px 8px", fontSize: 12, cursor: "pointer",
                    textAlign: "left", borderRadius: 4, width: "100%",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = "#1c1c2e")}
                  onMouseLeave={e => (e.currentTarget.style.background = "none")}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* URL Modal */}
      {urlModal && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.6)", zIndex: 100,
          display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={() => setUrlModal(null)}>
          <div style={{
            background: "#14141e", border: "1px solid #2a2a3a", borderRadius: 8,
            padding: 16, width: 360,
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12, color: "#e4e4f0" }}>
              {embedOptions.find(o => o.type === urlModal)?.label || "Embed URL"}
            </div>
            <input
              autoFocus
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleSubmit(); if (e.key === "Escape") setUrlModal(null); }}
              placeholder={urlModal === "video" ? "https://youtube.com/watch?v=..." :
                urlModal === "figma" ? "https://figma.com/file/..." :
                urlModal === "pdf" ? "https://example.com/document.pdf" :
                urlModal === "audio" ? "https://soundcloud.com/..." :
                "https://twitter.com/..."}
              style={{
                width: "100%", background: "#0a0a14", border: "1px solid #2a2a3a",
                color: "#e4e4f0", borderRadius: 4, padding: "6px 10px", fontSize: 12,
                fontFamily: "monospace", boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setUrlModal(null)}
                style={{
                  padding: "4px 12px", borderRadius: 4, fontSize: 12, cursor: "pointer",
                  background: "#111118", border: "1px solid #1c1c26", color: "#7a7a90",
                }}>
                Cancel
              </button>
              <button type="button" onClick={handleSubmit} disabled={!url.trim()}
                style={{
                  padding: "4px 12px", borderRadius: 4, fontSize: 12, cursor: "pointer",
                  background: url.trim() ? "#1a2a1a" : "#111118",
                  border: url.trim() ? "1px solid #2a4a2a" : "1px solid #1c1c26",
                  color: url.trim() ? "#4ade80" : "#5a5a70",
                }}>
                Embed
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
