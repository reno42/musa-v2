import { useState } from "react";
import { apiFetch } from "../lib/supabase";

interface PasteHtmlModalProps {
  templateId: string;
  frameId: string | null;
  onClose: () => void;
  onApplied?: () => void;
}

export function PasteHtmlModal({ templateId, frameId, onClose, onApplied }: PasteHtmlModalProps) {
  const [html, setHtml] = useState("");
  const [css, setCss] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const handleApply = async () => {
    if (!html.trim() && !css.trim()) {
      setMessage("Paste HTML and/or CSS first");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      // Use set_html and set_css MCP tools (now target frames by default)
      const params: Record<string, any> = { templateId };
      if (frameId) params.frameId = frameId;

      if (html.trim()) {
        await apiFetch<any>("/mcp", {
          method: "POST",
          body: JSON.stringify({ jsonrpc: "2.0", method: "set_html", params: { ...params, html: html.trim() }, id: 1 }),
        });
      }
      if (css.trim()) {
        await apiFetch<any>("/mcp", {
          method: "POST",
          body: JSON.stringify({ jsonrpc: "2.0", method: "set_css", params: { ...params, css: css.trim() }, id: 2 }),
        });
      }

      setMessage("✓ Applied to frame — refresh the frame to see changes");
      onApplied?.();
    } catch (e: any) {
      setMessage(`✗ Error: ${e.message || "Failed"}`);
    }
    setLoading(false);
  };

  return (
    <div
      className="image-upload-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="image-upload-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 600 }}>
        <div className="image-upload-header">
          <h2>📋 Paste HTML & CSS</h2>
          <button type="button" className="image-upload-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4, fontWeight: 600 }}>
              HTML (body content, no &lt;html&gt; or &lt;body&gt; tags)
            </label>
            <textarea
              value={html}
              onChange={e => setHtml(e.target.value)}
              placeholder="<div data-layer-id=&quot;hero&quot;>...</div>"
              style={{
                width: "100%", height: 140, background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: 10,
                color: "#ccc", fontSize: 12, fontFamily: "'Fira Code', 'Cascadia Code', monospace",
                resize: "vertical", lineHeight: 1.5,
              }}
            />
          </div>

          <div>
            <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4, fontWeight: 600 }}>
              CSS (stylesheet)
            </label>
            <textarea
              value={css}
              onChange={e => setCss(e.target.value)}
              placeholder={`@import url('https://fonts.googleapis.com/css2?...');\n\nbody {\n  width: 1080px;\n  height: 1080px;\n  ...\n}`}
              style={{
                width: "100%", height: 160, background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: 10,
                color: "#ccc", fontSize: 12, fontFamily: "'Fira Code', 'Cascadia Code', monospace",
                resize: "vertical", lineHeight: 1.5,
              }}
            />
          </div>

          <button
            type="button"
            onClick={handleApply}
            disabled={loading}
            style={{
              padding: "10px 20px", background: loading ? "rgba(139,92,246,0.3)" : "#8B5CF6",
              color: "#fff", border: "none", borderRadius: 8, cursor: loading ? "not-allowed" : "pointer",
              fontSize: 14, fontWeight: 600, fontFamily: "inherit", alignSelf: "flex-end",
            }}
          >
            {loading ? "⏳ Applying..." : "Apply to Frame"}
          </button>

          {message && (
            <div style={{
              fontSize: 12, color: message.startsWith("✓") ? "#4ade80" : "#f87171",
              padding: "8px 12px", background: "rgba(255,255,255,0.04)", borderRadius: 6,
            }}>
              {message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
