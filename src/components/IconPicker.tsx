import { useState, useMemo, useRef, useEffect } from "react";
import { apiFetch } from "../lib/supabase";

interface IconPickerProps {
  templateId: string;
  frameId: string | null;
  onClose: () => void;
  onInsert?: (layerId: string) => void;
}

interface IconResult {
  name: string;
  category: string;
  tags: string[];
  styles: string[];
  className: string;
  html: string;
}

const CATEGORIES = [
  "all", "arrows", "communication", "computers", "design", "education",
  "finance", "food", "gaming", "health", "maps", "media", "nature",
  "people", "photography", "shopping", "system", "text", "time", "weather",
];

const STYLE_OPTIONS = [
  { value: "regular", label: "Regular", cls: "ph" },
  { value: "bold", label: "Bold", cls: "ph-bold" },
  { value: "fill", label: "Fill", cls: "ph-fill" },
  { value: "light", label: "Light", cls: "ph-light" },
  { value: "thin", label: "Thin", cls: "ph-thin" },
  { value: "duotone", label: "Duotone", cls: "ph-duotone" },
];

export function IconPicker({ templateId, frameId, onClose, onInsert }: IconPickerProps) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [style, setStyle] = useState("regular");
  const [icons, setIcons] = useState<IconResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [inserting, setInserting] = useState<string | null>(null);
  const [color, setColor] = useState("#000000");
  const [size, setSize] = useState(48);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load Phosphor CSS once for live preview
  useEffect(() => {
    const id = "phosphor-preview-css";
    if (!document.getElementById(id)) {
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/@phosphor-icons/web@2.1.1";
      document.head.appendChild(link);
    }
  }, []);

  // Debounced search
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(doSearch, 200);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [search, category, style]);

  const doSearch = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (search.trim()) params.search = search.trim();
      if (category !== "all") params.category = category;
      params.style = style;
      params.limit = "60";
      const qs = new URLSearchParams(params).toString();
      const res = await apiFetch<any>(`/mcp`, {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "search_icons",
          params: Object.fromEntries(new URLSearchParams(qs)),
          id: 1,
        }),
      });

      // Unwrap MCP response
      const content = res?.result?.content?.[0];
      let data = res?.result;
      if (content?.type === "text" && content.text) {
        try { data = JSON.parse(content.text); } catch { /* keep raw */ }
      }
      setIcons(data?.icons || []);
    } catch {
      setIcons([]);
    }
    setLoading(false);
  };

  // Initial load
  useEffect(() => { doSearch(); }, []);

  const handleInsert = async (icon: IconResult) => {
    if (!frameId) return;
    setInserting(icon.name);
    try {
      const res = await apiFetch<any>("/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "insert_icon",
          params: {
            templateId,
            frameId,
            icon: icon.name,
            style,
            size,
            color,
          },
          id: 1,
        }),
      });

      const content = res?.result?.content?.[0];
      let data = res?.result;
      if (content?.type === "text" && content.text) {
        try { data = JSON.parse(content.text); } catch { /* keep raw */ }
      }

      if (data?.success) {
        onInsert?.(data.layerId);
      }
    } catch {
      // ignore
    }
    setInserting(null);
  };

  const previewCls = useMemo(() => {
    return STYLE_OPTIONS.find(s => s.value === style)?.cls || "ph";
  }, [style]);

  return (
    <div
      className="image-upload-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="image-upload-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 720, maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
        <div className="image-upload-header">
          <h2>Icons</h2>
          <button type="button" className="image-upload-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Controls */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <input
            type="text"
            placeholder="Search icons..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              flex: 1, minWidth: 180, padding: "8px 12px",
              background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 8, color: "#ccc", fontSize: 13, fontFamily: "inherit", outline: "none",
            }}
          />
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            style={{
              padding: "8px 12px", background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8,
              color: "#ccc", fontSize: 12, fontFamily: "inherit", outline: "none", cursor: "pointer",
            }}
          >
            {CATEGORIES.map(c => <option key={c} value={c} style={{ textTransform: "capitalize" }}>{c}</option>)}
          </select>
          <select
            value={style}
            onChange={e => setStyle(e.target.value)}
            style={{
              padding: "8px 12px", background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8,
              color: "#ccc", fontSize: 12, fontFamily: "inherit", outline: "none", cursor: "pointer",
            }}
          >
            {STYLE_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <label style={{ fontSize: 11, color: "#666" }}>Size</label>
            <input
              type="number" value={size} min={12} max={200}
              onChange={e => setSize(parseInt(e.target.value) || 48)}
              style={{ width: 50, padding: "6px 8px", background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6,
                color: "#ccc", fontSize: 12, fontFamily: "inherit", outline: "none", textAlign: "center" }}
            />
          </div>
          <input
            type="color" value={color}
            onChange={e => setColor(e.target.value)}
            style={{ width: 36, height: 36, border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 8, cursor: "pointer", background: "transparent", padding: 2 }}
          />
        </div>

        {/* Icon Grid */}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 200 }}>
          {loading ? (
            <div style={{ textAlign: "center", color: "#555", padding: 40 }}>Loading...</div>
          ) : icons.length === 0 ? (
            <div style={{ textAlign: "center", color: "#555", padding: 40 }}>No icons found</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))", gap: 8 }}>
              {icons.map(icon => (
                <button
                  key={icon.name}
                  type="button"
                  onClick={() => handleInsert(icon)}
                  disabled={inserting !== null}
                  title={icon.name}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                    padding: "14px 6px", background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10,
                    cursor: inserting ? "wait" : "pointer", transition: "all 0.15s ease",
                    color: inserting === icon.name ? "#8B5CF6" : color,
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(139,92,246,0.1)"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(139,92,246,0.3)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.06)"; }}
                >
                  <i className={`${previewCls} ph-${icon.name}`} style={{ fontSize: Math.min(size, 28), lineHeight: 1 }}></i>
                  <span style={{ fontSize: 9, color: "#555", textAlign: "center", wordBreak: "break-all", lineHeight: 1.2 }}>
                    {icon.name.length > 14 ? icon.name.slice(0, 12) + "…" : icon.name}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ fontSize: 10, color: "#444", textAlign: "center", marginTop: 8 }}>
          Powered by Phosphor Icons (MIT) · Click any icon to insert into frame
        </div>
      </div>
    </div>
  );
}
