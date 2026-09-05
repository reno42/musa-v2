import { useState, useEffect, useRef, useCallback, type PointerEvent as ReactPointerEvent } from "react";
import { loadGoogleFontInDocument } from "../lib/googleFonts";
import { cssFontFamily, primaryFamily } from "../lib/fontFamily";
import {
  listCustomFonts,
  uploadCustomFont,
  deleteCustomFont,
  loadCustomFontInDocument,
  type CustomFont,
} from "../lib/customFonts";
import { hashCrop, loadMatchCandidates, matchFontFromCrop, type FontMatch, type FontMatchCandidate } from "../lib/fontMatcher";

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
  const [matcherOpen, setMatcherOpen] = useState(false);
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
    try { await loadCustomFontInDocument(f); } catch { /* already registered or cached — the css still applies */ }
    onChange(f.familyName, { custom: f });
    setOpen(false);
    setSearch("");
  };

  /** «¿Qué fuente es?» — apply a matcher result exactly like a manual pick
   *  (system: name it; google: load the webfont; custom: register the face). */
  const applyMatch = (m: FontMatchCandidate) => {
    if (m.source === "custom" && m.custom) { void selectCustom(m.custom); return; }
    if (m.source !== "system") loadGoogleFontInDocument(m.family, m.variants?.length ? m.variants : ["regular"]);
    onChange(m.stack || m.family, { variants: m.variants });
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
          {/* ¿Qué fuente es? — el matcher vive DENTRO del picker (que ya está
              en las categorías del topbar y en el panel contextual): nada de
              botones nuevos en la barra. Determinista, sin IA, sin APIs
              externas — y confirma también a Arial cuando el diseño de verdad
              usa Arial. */}
          <button
            type="button"
            onClick={() => setMatcherOpen(o => !o)}
            style={{
              display: "flex", alignItems: "center", gap: 5, margin: "0 4px 2px",
              width: "calc(100% - 8px)", padding: "3px 6px", background: "#0f0f18",
              border: "1px solid #2a2a3a", borderRadius: 4, color: "#c8c4b8",
              fontSize: 11, cursor: "pointer", textAlign: "left",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></svg>
            {matcherOpen ? "Cerrar matcher" : "¿Qué fuente es?"}
          </button>
          {matcherOpen && <FontMatcherPanel customFonts={customFonts} onPick={applyMatch} />}
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

/** ── ¿Qué fuente es? ── Matcher determinista in-house: encuadras la palabra
 *  en la imagen, escribes qué dice, y el catálogo propio (Google + sistema +
 *  tus fuentes) se renderiza con ese texto y se rankea por similitud visual
 *  contra el recorte. El modelo nunca nombra la tipografía — la matemática
 *  sí, y el humano confirma de un vistazo. */
function FontMatcherPanel({ customFonts, onPick }: { customFonts: CustomFont[]; onPick: (match: FontMatchCandidate) => void }) {
  const [source, setSource] = useState<HTMLCanvasElement | null>(null);
  const [crop, setCrop] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [sampleText, setSampleText] = useState("Musa");
  const [script, setScript] = useState<"latin" | "korean" | "any">("latin");
  const [status, setStatus] = useState("");
  const [matches, setMatches] = useState<FontMatch[]>([]);
  const [busy, setBusy] = useState(false);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Redraw: image + dim outside the framed word + dashed selection border.
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || !source) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0);
    if (crop) {
      const x = Math.min(crop.x0, crop.x1), y = Math.min(crop.y0, crop.y1);
      const w = Math.abs(crop.x1 - crop.x0), h = Math.abs(crop.y1 - crop.y0);
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(0, 0, canvas.width, y);
      ctx.fillRect(0, y + h, canvas.width, canvas.height - y - h);
      ctx.fillRect(0, y, x, h);
      ctx.fillRect(x + w, y, canvas.width - x - w, h);
      ctx.strokeStyle = "#fff";
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
    }
  }, [source, crop]);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1400 / bitmap.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      setSource(canvas);
      setCrop(null);
      setMatches([]);
      setStatus("Encuadra la palabra con el mouse y escribe qué dice.");
    } catch { setStatus("No se pudo leer la imagen."); }
    if (fileRef.current) fileRef.current.value = "";
  };

  const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = previewRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width, Math.round((event.clientX - rect.left) * (canvas.width / rect.width)))),
      y: Math.max(0, Math.min(canvas.height, Math.round((event.clientY - rect.top) * (canvas.height / rect.height)))),
    };
  };

  const compare = async () => {
    if (!source || !crop || !sampleText.trim() || busy) return;
    setBusy(true);
    setMatches([]);
    try {
      const x = Math.min(crop.x0, crop.x1), y = Math.min(crop.y0, crop.y1);
      const w = Math.abs(crop.x1 - crop.x0), h = Math.abs(crop.y1 - crop.y0);
      const framed = document.createElement("canvas");
      framed.width = Math.max(1, w);
      framed.height = Math.max(1, h);
      framed.getContext("2d")!.drawImage(source, x, y, w, h, 0, 0, w, h);
      const cropBits = hashCrop(framed);
      if (!cropBits) { setStatus("El recuadro quedó vacío — encuadra la letra."); setBusy(false); return; }
      setStatus("Cargando catálogo…");
      const candidates = await loadMatchCandidates(script, customFonts);
      const results = await matchFontFromCrop({
        cropBits,
        sampleText: sampleText.trim(),
        candidates,
        onProgress: (done, total) => setStatus(`Comparando ${done}/${total}…`),
      });
      // Results render in their own face — Google families need their link.
      for (const m of results) {
        if (m.source === "google") loadGoogleFontInDocument(m.family, m.variants?.length ? m.variants : ["regular"]);
      }
      setMatches(results);
      setStatus(results.length ? "Click en una candidata para aplicarla." : "Sin candidatas — prueba otro recorte, más texto o script «Todo».");
    } catch (err: any) {
      setStatus(err?.message || "El matcher falló.");
    }
    setBusy(false);
  };

  const matchFontCss = (m: FontMatch) =>
    m.source === "custom" && m.custom ? `'${m.custom.familyName.replace(/'/g, "")}'`
      : m.source === "system" ? (m.stack || m.family)
      : `"${m.family.replace(/"/g, "")}"`;

  return (
    <div style={{ borderTop: "1px solid #1c1c26", borderBottom: "1px solid #1c1c26", padding: "6px 8px 8px" }}>
      <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 4 }}>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          style={{ padding: "2px 7px", borderRadius: 3, cursor: "pointer", border: "1px solid #2a2a3a", background: "#1a1a26", color: "#f0ebe0", fontSize: 10, whiteSpace: "nowrap" }}
        >{source ? "Otra imagen" : "1. Sube imagen"}</button>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => void handleFile(e.target.files?.[0])} />
        <input
          value={sampleText}
          onChange={e => setSampleText(e.target.value)}
          placeholder="Texto del recorte"
          style={{ flex: 1, minWidth: 0, padding: "2px 5px", background: "#0a0a0f", border: "1px solid #1c1c26", color: "#f0ebe0", borderRadius: 3, fontSize: 10 }}
        />
        <select
          value={script}
          onChange={e => setScript(e.target.value as "latin" | "korean" | "any")}
          title="Script del diseño — filtra el catálogo (Dongle es coreano)"
          style={{ padding: "2px 3px", background: "#0a0a0f", border: "1px solid #1c1c26", color: "#f0ebe0", borderRadius: 3, fontSize: 10 }}
        >
          <option value="latin">Latin</option>
          <option value="korean">Coreano</option>
          <option value="any">Todo</option>
        </select>
      </div>
      {source && (
        <canvas
          ref={previewRef}
          onPointerDown={e => { dragRef.current = true; const p = point(e); setCrop({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); }}
          onPointerMove={e => { if (!dragRef.current) return; const p = point(e); setCrop(c => c ? { ...c, x1: p.x, y1: p.y } : c); }}
          onPointerUp={() => { dragRef.current = false; }}
          onPointerLeave={() => { dragRef.current = false; }}
          style={{ width: "100%", cursor: "crosshair", borderRadius: 4, display: "block", touchAction: "none" }}
        />
      )}
      <button
        type="button"
        disabled={busy || !source || !crop || !sampleText.trim()}
        onClick={() => void compare()}
        style={{
          marginTop: 4, width: "100%", padding: "3px 6px", borderRadius: 3,
          cursor: busy || !source || !crop ? "wait" : "pointer",
          border: "1px solid #2a2a3a", background: "#1a1a26", color: "#f0ebe0",
          fontSize: 10, opacity: busy || !source || !crop ? 0.5 : 1,
        }}
      >{busy ? "Comparando…" : "2. Comparar con el catálogo"}</button>
      {status && <div style={{ marginTop: 3, fontSize: 10, color: "#7a7668" }}>{status}</div>}
      {matches.map(m => (
        <div
          key={`${m.source}:${m.family}`}
          onClick={() => onPick(m)}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 2px", cursor: "pointer", borderRadius: 3 }}
          onMouseEnter={e => { e.currentTarget.style.background = "#1a1a26"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
        >
          <span style={{ fontSize: 10, color: m.similarity >= 0.72 ? "#4ade80" : "#7a7668", fontFamily: "Inter", width: 30, flexShrink: 0 }}>
            {Math.round(m.similarity * 100)}%
          </span>
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, color: "#f0ebe0", fontFamily: matchFontCss(m) }}>{m.family}</span>
          <span style={{ fontSize: 9, color: "#7a7668", background: "#1a1a26", padding: "0 4px", borderRadius: 2, fontFamily: "Inter", flexShrink: 0 }}>
            {m.source === "custom" ? "tuya" : m.source === "system" ? "sistema" : "google"}
          </span>
        </div>
      ))}
    </div>
  );
}
