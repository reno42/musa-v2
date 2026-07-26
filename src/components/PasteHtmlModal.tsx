import { useState, useCallback, useMemo } from "react";
import { parseHtmlDocument } from "../lib/htmlParser";

export interface PasteResult {
  html: string;
  css: string;
  /** Detected frame width from CSS, if any */
  width: number | null;
  /** Detected frame height from CSS, if any */
  height: number | null;
}

interface PasteHtmlModalProps {
  onClose: () => void;
  onApply: (result: PasteResult) => void;
}

/**
 * Single-textarea modal: paste the FULL HTML document from Gemini (or any AI),
 * and it auto-parses body HTML, all <style> tags, and font @import links.
 *
 * Default mode: one textarea for the complete document.
 * Advanced toggle: split into separate HTML + CSS fields.
 */
export function PasteHtmlModal({ onClose, onApply }: PasteHtmlModalProps) {
  const [raw, setRaw] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [htmlManual, setHtmlManual] = useState("");
  const [cssManual, setCssManual] = useState("");

  // Live-parse the pasted document for preview
  const parsed = useMemo(() => {
    if (advanced) return null;
    if (!raw.trim()) return null;
    try {
      return parseHtmlDocument(raw);
    } catch {
      return null;
    }
  }, [raw, advanced]);

  const canApply = advanced
    ? (htmlManual.trim() || cssManual.trim())
    : (parsed && (parsed.html.trim() || parsed.css.trim()));

  const handleApply = useCallback(() => {
    if (advanced) {
      onApply({ html: htmlManual.trim(), css: cssManual.trim(), width: null, height: null });
    } else if (parsed) {
      onApply(parsed);
    }
  }, [advanced, parsed, htmlManual, cssManual, onApply]);

  return (
    <div
      className="image-upload-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="image-upload-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <div className="image-upload-header">
          <h2>📋 Paste HTML &amp; CSS</h2>
          <button type="button" className="image-upload-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Mode toggle */}
          <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
            <button
              type="button"
              onClick={() => setAdvanced(false)}
              style={{
                flex: 1, padding: "6px 12px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)",
                background: !advanced ? "rgba(139,92,246,0.2)" : "transparent",
                color: !advanced ? "#fff" : "#888", fontSize: 12, cursor: "pointer",
                fontFamily: "inherit", fontWeight: 500,
              }}
            >
              💎 Paste Complete Document
            </button>
            <button
              type="button"
              onClick={() => setAdvanced(true)}
              style={{
                flex: 1, padding: "6px 12px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)",
                background: advanced ? "rgba(139,92,246,0.2)" : "transparent",
                color: advanced ? "#fff" : "#888", fontSize: 12, cursor: "pointer",
                fontFamily: "inherit", fontWeight: 500,
              }}
            >
              ⚙️ Advanced (separate HTML/CSS)
            </button>
          </div>

          {!advanced ? (
            <>
              <div>
                <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4, fontWeight: 600 }}>
                  Paste the complete HTML document from Gemini, ChatGPT, Claude, etc.
                </label>
                <textarea
                  value={raw}
                  onChange={e => setRaw(e.target.value)}
                  placeholder={`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=1080">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap');
    body { width: 1080px; height: 1080px; margin: 0; background: #0a0a1a; font-family: 'Inter', sans-serif; }
    .hero { position: absolute; left: 60px; top: 80px; font-size: 72px; color: #fff; }
  </style>
</head>
<body>
  <div data-layer-id="hero" class="hero">Futuraria</div>
</body>
</html>`}
                  style={{
                    width: "100%", height: 260, background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: 12,
                    color: "#ccc", fontSize: 12, fontFamily: "'Fira Code', 'Cascadia Code', monospace",
                    resize: "vertical", lineHeight: 1.5, boxSizing: "border-box",
                  }}
                />
              </div>

              {/* Live parse preview */}
              {parsed && (
                <div style={{
                  fontSize: 12, color: "#aaa", padding: "10px 12px",
                  background: "rgba(255,255,255,0.04)", borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.06)",
                }}>
                  <div style={{ fontWeight: 600, marginBottom: 6, color: "#4ade80" }}>
                    ✓ Parsed successfully
                  </div>
                  <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                    <span>HTML: <strong style={{ color: "#ccc" }}>{parsed.html.length.toLocaleString()}</strong> chars</span>
                    <span>CSS: <strong style={{ color: "#ccc" }}>{parsed.css.length.toLocaleString()}</strong> chars</span>
                    {parsed.width && <span>Size: <strong style={{ color: "#8B5CF6" }}>{parsed.width}×{parsed.height || parsed.width}px</strong></span>}
                    {!parsed.width && <span style={{ color: "#fbbf24" }}>⚠ No body dimensions detected — defaults to 1080×1080</span>}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div>
                <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4, fontWeight: 600 }}>
                  HTML (body content, no &lt;html&gt; or &lt;body&gt; tags)
                </label>
                <textarea
                  value={htmlManual}
                  onChange={e => setHtmlManual(e.target.value)}
                  placeholder={`<div data-layer-id="hero" class="hero">Futuraria</div>`}
                  style={{
                    width: "100%", height: 140, background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: 10,
                    color: "#ccc", fontSize: 12, fontFamily: "'Fira Code', 'Cascadia Code', monospace",
                    resize: "vertical", lineHeight: 1.5, boxSizing: "border-box",
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4, fontWeight: 600 }}>
                  CSS (stylesheet)
                </label>
                <textarea
                  value={cssManual}
                  onChange={e => setCssManual(e.target.value)}
                  placeholder={`@import url('https://fonts.googleapis.com/css2?...');\n\nbody {\n  width: 1080px;\n  height: 1080px;\n  margin: 0;\n  background: #0a0a1a;\n}\n\n.hero { ... }`}
                  style={{
                    width: "100%", height: 160, background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: 10,
                    color: "#ccc", fontSize: 12, fontFamily: "'Fira Code', 'Cascadia Code', monospace",
                    resize: "vertical", lineHeight: 1.5, boxSizing: "border-box",
                  }}
                />
              </div>
            </>
          )}

          <div style={{ fontSize: 10, color: "#666", lineHeight: 1.5 }}>
            💡 <strong>Tip:</strong> Paste the full HTML that Gemini/ChatGPT/Claude gave you.
            The editor auto-extracts styles and body content.
            {!advanced && " Use <strong>Advanced</strong> tab if you need separate HTML/CSS fields."}
          </div>

          <button
            type="button"
            onClick={handleApply}
            disabled={!canApply}
            style={{
              padding: "12px 24px", background: canApply ? "#8B5CF6" : "rgba(255,255,255,0.06)",
              color: canApply ? "#fff" : "#555", border: "none", borderRadius: 8,
              cursor: canApply ? "pointer" : "not-allowed",
              fontSize: 14, fontWeight: 600, fontFamily: "inherit", alignSelf: "flex-end",
              transition: "background 0.15s ease",
            }}
          >
            Apply to Frame
          </button>
        </div>
      </div>
    </div>
  );
}
