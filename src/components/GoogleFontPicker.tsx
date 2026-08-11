import { useState, useEffect, useRef } from "react";
import { loadGoogleFontInDocument } from "../lib/googleFonts";

interface FontEntry {
  family: string;
  category: string;
  variants: string[];
  /** "system" is already on the machine; "google" has to be fetched. */
  source?: "system" | "google";
  /** System fonts only: the family plus its substitutes, which is what goes
   *  into the design so a file made on a Mac still renders on a PC. */
  stack?: string;
  availability?: string;
}

/** Why a search came back empty, when the reason is licensing. */
interface CatalogNote { note: string; instead: string[] }

/** Fetch the Google Fonts catalog from the REST API */
/**
 * Asks the server, which searches the whole library rather than the page the
 * picker happens to be holding. With GOOGLE_FONTS_API_KEY set that is ~1800
 * families, and filtering ~1800 entries in the browser on every keystroke is
 * work the database already does better.
 */
async function fetchCatalog(search: string): Promise<{ fonts: FontEntry[]; note: CatalogNote | null }> {
  try {
    const params = new URLSearchParams({ limit: "120" });
    if (search.trim()) params.set("search", search.trim());
    const res = await fetch(`/api/fonts/catalog?${params}`);
    const json = await res.json();
    if (json.success && json.data?.fonts) {
      return { fonts: json.data.fonts, note: json.data.note || null };
    }
    return { fonts: [], note: null };
  } catch {
    return { fonts: [], note: null }; // offline — the picker still opens
  }
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
  const [note, setNote] = useState<CatalogNote | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // Re-queried as you type, debounced: the server holds the full library.
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void fetchCatalog(search).then(({ fonts, note: n }) => {
        if (cancelled) return;
        setCatalog(fonts);
        setNote(n);
      });
    }, search ? 180 : 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [search]);

  // Close dropdown on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // The server already searched; filtering again here would only hide results
  // it deliberately matched (a family found by category, for instance).
  const filtered = catalog;


  const select = (f: FontEntry) => {
    // A system font must not be requested from Google — that link 404s and
    // the browser falls back silently, which looks like the picker ignoring
    // the click. It is already installed; naming it is enough.
    if (f.source !== "system") loadGoogleFontInDocument(f.family, f.variants);
    onChange(f.stack || f.family);
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
          {/* The category pills lived here. Searching by name is what people
              actually do — nobody opens a font list wanting "a serif", they
              want Georgia — and the row of keyword buttons cost a line of
              chrome above every search to filter a list the search already
              filters. */}
          {note && (
            <div style={{ padding: "8px 8px 6px", fontSize: 11, color: "#9a9ab0", lineHeight: 1.5 }}>
              <div style={{ color: "#f0ebe0" }}>{note.note}</div>
              <div style={{ marginTop: 4 }}>Alternativas gratuitas:</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 3 }}>
                {note.instead.map(alt => (
                  <button
                    key={alt}
                    type="button"
                    onClick={() => setSearch(alt)}
                    style={{
                      padding: "2px 7px", borderRadius: 3, cursor: "pointer",
                      border: "1px solid #2a2a3a", background: "#1a1a26", color: "#f0ebe0",
                      fontSize: 11,
                    }}
                  >{alt}</button>
                ))}
              </div>
            </div>
          )}
          {!note && search && filtered.length === 0 && (
            <div style={{ padding: 10, fontSize: 11, color: "#9a9ab0" }}>
              Sin resultados para “{search}”.
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
