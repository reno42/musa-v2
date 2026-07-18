import { useCallback, useEffect, useRef, useState } from "react";

interface FileMeta {
  brand: string;
  tags: string[];
  theme: string;
  format: string;
  file_type: string;
  cover_image_url: string;
  obsidian_link: string;
}

interface Props {
  templateId: string | null;
  thumbnailUrl?: string | null;      // auto-generated, fallback
  onCoverCapture?: () => Promise<string | null>;  // returns base64 data URL
}

const FORMATS = ["", "web", "mobile", "social", "print", "email"];
const FILE_TYPES = ["", "frame", "deck", "template", "export"];

export function FileInfoPanel({ templateId, thumbnailUrl, onCoverCapture }: Props) {
  const [meta, setMeta] = useState<FileMeta>({
    brand: "", tags: [], theme: "", format: "", file_type: "", cover_image_url: "", obsidian_link: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const metaRef = useRef<FileMeta>(meta);

  // Fetch metadata on mount / templateId change
  useEffect(() => {
    if (!templateId) { setLoading(false); return; }
    setLoading(true);
    fetch(`/api/meta/${templateId}`)
      .then(r => r.json())
      .then(d => {
        if (d.success && d.data) {
          const m = {
            brand: d.data.brand || "",
            tags: d.data.tags || [],
            theme: d.data.theme || "",
            format: d.data.format || "",
            file_type: d.data.file_type || "",
            cover_image_url: d.data.cover_image_url || "",
            obsidian_link: d.data.obsidian_link || "",
          };
          setMeta(m);
          metaRef.current = m;
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [templateId]);

  // Debounced auto-save
  const scheduleSave = useCallback((patch: Partial<FileMeta>) => {
    if (!templateId) return;
    const next = { ...metaRef.current, ...patch };
    setMeta(next);
    metaRef.current = next;

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      try {
        await fetch(`/api/meta/${templateId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        });
      } catch {} finally { setSaving(false); }
    }, 2000);
  }, [templateId]);

  // Cleanup timer
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  // Tags
  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (!t || meta.tags.includes(t)) return;
    scheduleSave({ tags: [...meta.tags, t] });
    setTagInput("");
  };

  const removeTag = (tag: string) => {
    scheduleSave({ tags: meta.tags.filter(t => t !== tag) });
  };

  // Upload cover
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !templateId) return;
    setUploading(true);
    try {
      const reader = new FileReader();
      const b64 = await new Promise<string>((resolve) => {
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
      const res = await fetch(`/api/meta/${templateId}/cover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: b64 }),
      });
      const d = await res.json();
      if (d.success) scheduleSave({ cover_image_url: d.data.cover_image_url });
    } catch {} finally { setUploading(false); }
  }, [templateId]);

  const handleSnapshot = useCallback(async () => {
    if (!onCoverCapture || !templateId) return;
    setUploading(true);
    try {
      const b64 = await onCoverCapture();
      if (!b64) return;
      const res = await fetch(`/api/meta/${templateId}/cover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: b64 }),
      });
      const d = await res.json();
      if (d.success) scheduleSave({ cover_image_url: d.data.cover_image_url });
    } catch {} finally { setUploading(false); }
  }, [templateId, onCoverCapture]);

  if (loading) return <div style={panelStyle}>Loading…</div>;

  const coverSrc = meta.cover_image_url || thumbnailUrl;

  return (
    <div style={panelStyle}>
      {/* Cover Image */}
      <div style={sectionStyle}>
        <label style={labelStyle}>Cover</label>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          {coverSrc ? (
            <img src={coverSrc} alt="Cover" style={{ width: 80, height: 60, objectFit: "cover", borderRadius: 4, border: "1px solid rgba(255,255,255,0.1)" }} />
          ) : (
            <div style={{ width: 80, height: 60, borderRadius: 4, border: "1px dashed rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontSize: 10 }}>
              No cover
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={uploadBtnStyle}>
              {uploading ? "Uploading…" : "Upload PNG/JPG"}
              <input type="file" accept="image/png,image/jpeg" style={{ display: "none" }} onChange={handleFileUpload} disabled={uploading} />
            </label>
            {onCoverCapture && (
              <button type="button" style={snapshotBtnStyle} onClick={handleSnapshot} disabled={uploading}>
                Use snapshot
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Brand */}
      <div style={sectionStyle}>
        <label style={labelStyle}>Brand</label>
        <input
          style={inputStyle}
          value={meta.brand}
          onChange={e => scheduleSave({ brand: e.target.value })}
          placeholder="e.g. BMW, Nike"
        />
      </div>

      {/* Tags */}
      <div style={sectionStyle}>
        <label style={labelStyle}>Tags</label>
        <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
          <input
            style={{ ...inputStyle, flex: 1 }}
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
            placeholder="Add tag…"
          />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {meta.tags.map(tag => (
            <span key={tag} style={chipStyle}>
              {tag}
              <button type="button" onClick={() => removeTag(tag)} style={chipRemoveStyle}>×</button>
            </span>
          ))}
        </div>
      </div>

      {/* Theme */}
      <div style={sectionStyle}>
        <label style={labelStyle}>Theme</label>
        <input
          style={inputStyle}
          value={meta.theme}
          onChange={e => scheduleSave({ theme: e.target.value })}
          placeholder="e.g. corporate, minimal"
        />
      </div>

      {/* Format */}
      <div style={sectionStyle}>
        <label style={labelStyle}>Format</label>
        <select
          style={selectStyle}
          value={meta.format}
          onChange={e => scheduleSave({ format: e.target.value })}
        >
          {FORMATS.map(f => <option key={f} value={f}>{f || "—"}</option>)}
        </select>
      </div>

      {/* File Type */}
      <div style={sectionStyle}>
        <label style={labelStyle}>File Type</label>
        <select
          style={selectStyle}
          value={meta.file_type}
          onChange={e => scheduleSave({ file_type: e.target.value })}
        >
          {FILE_TYPES.map(f => <option key={f} value={f}>{f || "—"}</option>)}
        </select>
      </div>

      {/* Obsidian Link */}
      <div style={sectionStyle}>
        <label style={labelStyle}>Obsidian Link</label>
        <input
          style={inputStyle}
          value={meta.obsidian_link}
          onChange={e => scheduleSave({ obsidian_link: e.target.value })}
          placeholder="obsidian://open?vault=design&file=..."
        />
        {meta.obsidian_link && (
          <a href={meta.obsidian_link} target="_blank" rel="noreferrer" style={{ color: "#93c5fd", fontSize: 11, marginTop: 4, display: "inline-block" }}>
            Open in Obsidian ↗
          </a>
        )}
      </div>

      {/* Save indicator */}
      <div style={{ padding: "4px 0", fontSize: 10, color: "#666", textAlign: "right" }}>
        {saving ? "Saving…" : templateId ? "Auto-saved" : "No template selected"}
      </div>
    </div>
  );
}

// ── Styles ──

const panelStyle: React.CSSProperties = {
  width: "100%", minWidth: 0, minHeight: 0, flex: 1,
  overflowY: "auto", overflowX: "hidden",
  padding: "8px 10px",
  fontSize: 12,
  fontFamily: "Inter, system-ui, sans-serif",
  color: "var(--text-primary, #dddbd4)",
};

const sectionStyle: React.CSSProperties = {
  marginBottom: 12,
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 10,
  color: "#888",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "4px 8px",
  fontSize: 11,
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 4,
  color: "#ddd",
  outline: "none",
  fontFamily: "Inter, system-ui, sans-serif",
  boxSizing: "border-box",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: "pointer",
  appearance: "auto",
};

const chipStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 2,
  padding: "1px 6px",
  fontSize: 10,
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 10,
  color: "#ccc",
};

const chipRemoveStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#888",
  cursor: "pointer",
  fontSize: 13,
  lineHeight: 1,
  padding: "0 1px",
};

const uploadBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "4px 10px",
  fontSize: 10,
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 4,
  color: "#ccc",
  cursor: "pointer",
};

const snapshotBtnStyle: React.CSSProperties = {
  ...uploadBtnStyle,
  background: "rgba(59,130,246,0.15)",
  border: "1px solid rgba(59,130,246,0.3)",
  color: "#93c5fd",
};
