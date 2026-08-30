import { useState, useEffect, useRef, useCallback } from "react";
import { loadGoogleFontInDocument } from "../lib/googleFonts";
import { cssFontFamily, primaryFamily } from "../lib/fontFamily";
import {
  listCustomFonts,
  uploadCustomFont,
  deleteCustomFont,
  loadCustomFontInDocument,
  type CustomFont,
} from "../lib/customFonts";

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

/** The catalog plus its honesty fields: where it came from and how big it is.
 *  A reduced catalog must announce itself — the old fallback swapped in the
 *  bundled list silently and the picker looked complete at 94 fonts. */
interface CatalogState {
  fonts: FontEntry[];
  note: CatalogNote | null;
  live: boolean;
  total: number;
}

async function fetchCatalog(search: string): Promise<CatalogState> {
  try {
    const params = new URLSearchParams({ limit: "120" });
    if (search.trim()) params.set("search", search.trim());
    const res = await fetch(`/api/fonts/catalog?${params}`);
    const json = await res.json();
    if (json.success && json.data?.fonts) {
      return {
        fonts: json.data.fonts,
        note: json.data.note || null,
        live: json.data.live !== false,
        total: json.data.total || 0,
      };
    }
    return { fonts: [], note: null, live: false, total: 0 };
  } catch {
    return { fonts: [], note: null, live: false, total: 0 }; // offline — the picker still opens, and says so
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
  /** meta.custom carries the uploaded font so the editor wires its @font-face
   *  into document, frames and persisted css; meta.variants lets frames load
   *  every weight of a Google family, not just the default 400. */
  onChange: (fontFamily: string, meta?: { variants?: string[]; custom?: CustomFont }) => void;
}

export function GoogleFontPicker({ value, onChange }: Props) {
  const [catalog, setCatalog] = useState<CatalogState>({ fonts: [], note: null, live: true, total: 0 });
  const [customFonts, setCustomFonts] = useState<CustomFont[]>([]);
  const [uploading, setUploading] = useState(false);
  const [customError, setCustomError] = useState("");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [attempt, setAttempt] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const ref = useRef<HTMLDivElement>(null);

  const reloadCustom = useCallback(async () => {
    try { setCustomFonts(await listCustomFonts()); } catch { /* signed out or offline — the section just stays empty */ }
  }, []);

  // Re-queried as you type, debounced: the server holds the full library.
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void fetchCatalog(search).then(state => {
        if (cancelled) return;
        setCatalog(state);
      });
    }, search ? 180 : 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [search, attempt]);

  // Custom fonts load when the dropdown opens, not on every editor mount.
  useEffect(() => {
    if (open) void reloadCustom();
  }, [open, reloadCustom]);

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
  const filtered = catalog.fonts;
  const selectedPrimary = primaryFamily(value);

  const selectGoogle = (f: FontEntry) => {
    // A system font must not be requested from Google — that link 404s and
    // the browser falls back silently, which looks like the picker ignoring
    // the click. It is already installed; naming it is enough.
    if (f.source !== "system") loadGoogleFontInDocument(f.family, f.variants);
    onChange(f.stack || f.family, { variants: f.variants });
    setOpen(false);
    setSearch("");
  };

  const selectCustom = async (f: CustomFont) => {
    try {
      await loadCustomFontInDocument(f);
    } catch (err: any) {
      // The css still applies, but a face that failed (bucket down, corrupt
      // file) renders text as fallback — say so instead of swallowing it.
      setCustomError(err?.message || `No se pudo cargar «${f.familyName}»`);
    }
    onChange(f.familyName, { custom: f });
    setOpen(false);
    setSearch("");
  };

  const handleUpload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setCustomError("");
    try {
      const font = await uploadCustomFont(file);
      await reloadCustom();
      await selectCustom(font);
    } catch (err: any) {
      setCustomError(err?.message || "No se pudo subir la fuente");
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleDelete = async (font: CustomFont) => {
    setCustomError("");
    try {
      await deleteCustomFont(font.id);
      setCustomFonts(list => list.filter(f => f.id !== font.id));
    } catch (err: any) {
      setCustomError(err?.message || "No se pudo borrar la fuente");
    }
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
          textAlign: "left", cursor: "pointer", fontFamily: cssFontFamily(value),
        }}
      >
        {/* The label shows the family, not its substitutes — callers pass
            whichever they hold, and "Helvetica, Arial, sans-serif" is not a
            font name a person picked. */}
        {selectedPrimary || "Select font..."}
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 999,
          background: "#111118", border: "1px solid #1c1c26", borderRadius: 6,
          maxHeight: 300, overflowY: "auto",
        }}>
          <input
            autoFocus
            placeholder="Buscar en toda la librería…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              margin: 4, width: "calc(100% - 8px)", padding: "4px 6px",
              background: "#0a0a0f", border: "1px solid #1c1c26",
              color: "#f0ebe0", borderRadius: 4, fontSize: 12,
            }}
          />
          {/* ── Tus fuentes: uploads live here, scoped to this account ── */}
          <div style={{ borderBottom: "1px solid #1c1c26", padding: "5px 8px 6px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
              <span style={{ fontSize: 9, letterSpacing: 1, color: "#7a7668", fontFamily: "Inter" }}>TUS FUENTES</span>
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
                style={{
                  padding: "1px 7px", borderRadius: 3, cursor: uploading ? "wait" : "pointer",
                  border: "1px solid #2a2a3a", background: "#1a1a26", color: "#f0ebe0", fontSize: 10,
                }}
              >{uploading ? "Subiendo…" : "+ Subir"}</button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".ttf,.otf,.woff,.woff2"
              hidden
              onChange={e => void handleUpload(e.target.files?.[0])}
            />
            {customError && <div style={{ fontSize: 10, color: "#f87171", marginBottom: 3 }}>{customError}</div>}
            {customFonts.map(f => (
              <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0" }}>
                <span
                  onClick={() => void selectCustom(f)}
                  style={{
                    flex: 1, cursor: "pointer", fontSize: 13, overflow: "hidden",
                    textOverflow: "ellipsis", whiteSpace: "nowrap",
                    fontFamily: `'${f.familyName.replace(/'/g, "")}', Inter`,
                    color: selectedPrimary === f.familyName ? "#4ade80" : "#f0ebe0",
                  }}
                  title={`${f.fileName} · ${(f.sizeBytes / 1024).toFixed(0)}KB`}
                >{f.familyName}</span>
                <button
                  type="button"
                  aria-label={`Borrar ${f.familyName}`}
                  onClick={() => void handleDelete(f)}
                  style={{
                    border: "none", background: "transparent", color: "#7a7668",
                    cursor: "pointer", fontSize: 12, padding: "0 2px",
                  }}
                >×</button>
              </div>
            ))}
            {customFonts.length === 0 && !customError && (
              <div style={{ fontSize: 10, color: "#5f6b7a", padding: "1px 0 2px" }}>
                Sube tu .ttf / .otf / .woff — queda solo en tu cuenta.
              </div>
            )}
          </div>
          {/* ── Catalog honesty: source, size, and a retry when reduced ── */}
          {!catalog.live ? (
            <div style={{ padding: "6px 8px", fontSize: 11, color: "#facc15", display: "flex", gap: 6, alignItems: "center" }}>
              <span>Catálogo reducido — sin respuesta de Google.</span>
              <button
                type="button"
                onClick={() => setAttempt(n => n + 1)}
                style={{
                  padding: "1px 7px", borderRadius: 3, cursor: "pointer",
                  border: "1px solid #2a2a3a", background: "#1a1a26", color: "#f0ebe0", fontSize: 10,
                }}
              >Reintentar</button>
            </div>
          ) : (
            <div style={{ padding: "3px 8px 2px", fontSize: 10, color: "#5f6b7a", fontFamily: "Inter" }}>
              {catalog.total > 0 ? `${catalog.total} coincidencias` : "Catálogo completo"} · Google Fonts API
            </div>
          )}
          {/* The category pills lived here. Searching by name is what people
              actually do — nobody opens a font list wanting "a serif", they
              want Georgia — and the row of keyword buttons cost a line of
              chrome above every search to filter a list the search already
              filters. */}
          {catalog.note && (
            <div style={{ padding: "8px 8px 6px", fontSize: 11, color: "#9a9ab0", lineHeight: 1.5 }}>
              <div style={{ color: "#f0ebe0" }}>{catalog.note.note}</div>
              <div style={{ marginTop: 4 }}>Alternativas gratuitas:</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 3 }}>
                {catalog.note.instead.map(alt => (
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
          {!catalog.note && search && filtered.length === 0 && catalog.live && (
            <div style={{ padding: 10, fontSize: 11, color: "#9a9ab0" }}>
              Sin resultados para “{search}”.
            </div>
          )}
          {filtered.map(f => (
            <div
              key={f.family}
              onClick={() => selectGoogle(f)}
              style={{
                padding: "4px 8px", cursor: "pointer", fontSize: 13,
                fontFamily: f.source === "system" ? undefined : f.family, color: f.family === value ? "#4ade80" : "#f0ebe0",
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
          {filtered.length === 0 && !search && catalog.live && (
            <div style={{ padding: "8px 12px", color: "#7a7668", fontSize: 11 }}>
              Loading catalog…
            </div>
          )}
        </div>
      )}
    </div>
  );
}
