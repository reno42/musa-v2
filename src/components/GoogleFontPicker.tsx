import { useState, useEffect, useRef } from "react";

interface FontEntry {
  family: string;
  category: string;
  variants: string[];
}

/** Fetch the Google Fonts catalog from the REST API */
async function fetchCatalog(): Promise<FontEntry[]> {
  try {
    const res = await fetch("/api/fonts/catalog?limit=200");
    const json = await res.json();
    if (json.success && json.data?.fonts) return json.data.fonts;
    return [];
  } catch {
    return []; // offline fallback — returns empty, handled gracefully
  }
}

/** Dynamically load a Google Font via CSS link tag */
function loadFont(family: string, variants: string[] = ["400","700"]) {
  const id = `gf-${family.replace(/\s+/g, "-").toLowerCase()}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@${variants.join(";")}&display=swap`;
  document.head.appendChild(link);
}

const CATEGORY_LABELS: Record<string, string> = {
  "sans-serif": "Sans",
  "serif": "Serif",
  "display": "Display",
  "handwriting": "Hand",
  "monospace": "Mono",
};

interface Props {
  value: string;
  onChange: (fontFamily: string) => void;
}

export function GoogleFontPicker({ value, onChange }: Props) {
  const [catalog, setCatalog] = useState<FontEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // Load catalog on mount
  useEffect(() => { fetchCatalog().then(setCatalog); }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const filtered = catalog.filter(f => {
    if (search && !f.family.toLowerCase().includes(search.toLowerCase())) return false;
    if (categoryFilter && f.category !== categoryFilter) return false;
    return true;
  });

  // Deduplicate for category pills
  const categories = [...new Set(catalog.map(f => f.category))];

  const select = (f: FontEntry) => {
    console.warn("[PICKER select] font chosen", { family: f.family, variants: f.variants, onChangeType: typeof onChange });
    loadFont(f.family, f.variants);
    onChange(f.family);
    setOpen(false);
    setSearch("");
  };

  return (
    <div ref={ref} style={{ position: "relative", flex: 1 }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label="Select font"
        style={{
          width: "100%", background: "#111118", border: "1px solid #1c1c26",
          color: "#f0ebe0", borderRadius: 4, padding: "3px 6px", fontSize: 12,
          textAlign: "left", cursor: "pointer", fontFamily: value,
        }}
      >
        {value || "Select font..."}
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 999,
          background: "#111118", border: "1px solid #1c1c26", borderRadius: 6,
          maxHeight: 260, overflowY: "auto",
        }}>
          <input
            autoFocus
            placeholder="Search 94 fonts..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              margin: 4, width: "calc(100% - 8px)", padding: "4px 6px",
              background: "#0a0a0f", border: "1px solid #1c1c26",
              color: "#f0ebe0", borderRadius: 4, fontSize: 12,
            }}
          />
          {/* Category filter pills */}
          {catalog.length > 0 && (
            <div style={{ display: "flex", gap: 4, padding: "2px 6px", flexWrap: "wrap" }}>
              {categories.map(cat => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoryFilter(categoryFilter === cat ? "" : cat)}
                  style={{
                    padding: "1px 5px", borderRadius: 3, border: "1px solid #2a2a3a",
                    background: categoryFilter === cat ? "#2563eb" : "#1a1a26",
                    color: categoryFilter === cat ? "#fff" : "#9a9ab0",
                    fontSize: 10, cursor: "pointer", lineHeight: "16px",
                  }}
                >
                  {CATEGORY_LABELS[cat] || cat}
                </button>
              ))}
            </div>
          )}
          {filtered.map(f => (
            <div
              key={f.family}
              onClick={() => select(f)}
              style={{
                padding: "4px 8px", cursor: "pointer", fontSize: 13,
                fontFamily: f.family, color: f.family === value ? "#4ade80" : "#f0ebe0",
                background: f.family === value ? "#1a2a1a" : "transparent",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                display: "flex", alignItems: "center", gap: 6,
              }}
            >
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{f.family}</span>
              <span style={{
                fontSize: 9, color: "#7a7668", background: "#1a1a26",
                padding: "0 4px", borderRadius: 2, fontFamily: "Inter",
              }}>
                {CATEGORY_LABELS[f.category] || f.category}
              </span>
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: "8px 12px", color: "#7a7668", fontSize: 11 }}>
              {catalog.length === 0 ? "Loading catalog…" : "No matching fonts"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
