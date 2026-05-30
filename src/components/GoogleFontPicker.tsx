import { useState, useEffect, useRef } from "react";

/** Top 50 popular Google Fonts — loaded on demand via CSS (no API key) */
const POPULAR_FONTS = [
  "Inter", "Roboto", "Open Sans", "Montserrat", "Poppins", "Lato", "Oswald",
  "Raleway", "Nunito", "Playfair Display", "Merriweather", "Ubuntu", "PT Sans",
  "Noto Sans", "Dancing Script", "Pacifico", "Bebas Neue", "Crimson Text",
  "Josefin Sans", "Libre Baskerville", "Arimo", "Lora", "Fira Sans",
  "Work Sans", "DM Sans", "Manrope", "Space Grotesk", "Syne", "Archivo",
  "Lexend", "Plus Jakarta Sans", "Outfit", "Sora", "Rubik", "Quicksand",
  "Titillium Web", "Comfortaa", "Righteous", "Lobster", "Abril Fatface",
  "Alfa Slab One", "Anton", "Archivo Black", "Caveat", "Exo 2",
  "Orbitron", "Permanent Marker", "Shadows Into Light", "Teko", "Zilla Slab",
];

/** Dynamically load a Google Font via CSS link tag */
function loadFont(family: string) {
  const id = `gf-${family.replace(/\s+/g, "-").toLowerCase()}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@400;700&display=swap`;
  document.head.appendChild(link);
}

interface Props {
  value: string;
  onChange: (fontFamily: string) => void;
}

export function GoogleFontPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const filtered = search
    ? POPULAR_FONTS.filter(f => f.toLowerCase().includes(search.toLowerCase()))
    : POPULAR_FONTS;

  const select = (f: string) => {
    loadFont(f);
    onChange(f);
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
          color: "#e4e4f0", borderRadius: 4, padding: "3px 6px", fontSize: 12,
          textAlign: "left", cursor: "pointer", fontFamily: value,
        }}
      >
        {value || "Select font..."}
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 999,
          background: "#111118", border: "1px solid #1c1c26", borderRadius: 6,
          maxHeight: 220, overflowY: "auto",
        }}>
          <input
            autoFocus
            placeholder="Search fonts..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              margin: 4, width: "calc(100% - 8px)", padding: "4px 6px",
              background: "#0a0a0f", border: "1px solid #1c1c26",
              color: "#e4e4f0", borderRadius: 4, fontSize: 12,
            }}
          />
          {filtered.map(f => (
            <div
              key={f}
              onClick={() => select(f)}
              style={{
                padding: "4px 8px", cursor: "pointer", fontSize: 13,
                fontFamily: f, color: f === value ? "#4ade80" : "#e4e4f0",
                background: f === value ? "#1a2a1a" : "transparent",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}
            >
              {f}
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: "8px 12px", color: "#7a7a90", fontSize: 11 }}>
              No matching fonts
            </div>
          )}
        </div>
      )}
    </div>
  );
}
