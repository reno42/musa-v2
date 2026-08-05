import { useState, useEffect, useRef, useMemo } from "react";
import { apiFetch } from "../lib/supabase";
import { streamGenerate, type QuiverEvent } from "../lib/quiverStream";

export interface IconPayload {
  library: string;
  name: string;
  style: string;
  color: string;
  size: number;
}

export interface IllustrationPayload {
  kind: "illustration";
  slug: string;
  title: string;
  width: number;
  height: number;
}

export interface PhotoPayload {
  kind: "photo";
  url: string;
  alt: string;
  width: number;
  height: number;
  /** Unsplash requires crediting the photographer wherever a photo is used. */
  credit: { name: string; link: string };
}

interface IconPickerProps {
  /** Screen position of the trigger button — the panel anchors beside it
   *  instead of covering the editor like the old full-screen modal did. */
  anchorRect: DOMRect | null;
  onClose: () => void;
  /** Click-to-insert. The caller (EditorV2) owns placement: into the
   *  selected frame, or as a canvas object if nothing is selected — this
   *  component only ever hands back "which asset, what color/size". */
  onInsertIcon: (icon: IconPayload) => void;
  onInsertIllustration: (ill: IllustrationPayload) => void;
  onInsertPhoto: (photo: PhotoPayload) => void;
  /** Insert a generated SVG as a vector layer (Quiver AI text-to-SVG). */
  onInsertSvg?: (svg: string) => void;
  insertError?: string;
}

interface IconResult {
  name: string;
  category: string;
  tags: string[];
  library: string;
  style: string;
  svgPreview: string;
}

interface IllustrationResult {
  slug: string;
  title: string;
  url: string;
  width: number;
  height: number;
}

interface PhotoResult {
  id: string;
  thumb: string;
  full: string;
  alt: string;
  width: number;
  height: number;
  credit: { name: string; link: string };
}

const CATEGORIES = [
  "all", "arrows", "communication", "computers", "design", "education",
  "finance", "food", "gaming", "health", "maps", "media", "nature",
  "people", "photography", "shopping", "system", "text", "time", "weather",
];

const LIBRARIES: { value: string; label: string; styles: { value: string; label: string }[] }[] = [
  {
    value: "phosphor", label: "Phosphor",
    styles: [
      { value: "regular", label: "Regular" }, { value: "bold", label: "Bold" }, { value: "fill", label: "Fill" },
      { value: "light", label: "Light" }, { value: "thin", label: "Thin" }, { value: "duotone", label: "Duotone" },
    ],
  },
  { value: "lucide", label: "Lucide", styles: [{ value: "regular", label: "Regular" }] },
  { value: "tabler", label: "Tabler", styles: [{ value: "outline", label: "Outline" }, { value: "filled", label: "Filled" }] },
  { value: "simple-icons", label: "Marcas", styles: [{ value: "regular", label: "Regular" }] },
  { value: "iconify", label: "Todos", styles: [{ value: "regular", label: "Regular" }] },
];

/** Unsplash needs an access key the user supplies themselves (same
 *  bring-your-own-key model the chat already uses for its LLM provider) —
 *  it's their quota and their API terms, so it's stored per-browser and
 *  never travels through our backend. */
const LS_UNSPLASH_KEY = "futuraria-unsplash-key";

/** Relative luminance (0=black, 1=white) — decides whether an icon's own
 *  swatch card needs a light or dark backing so it never disappears into
 *  it (a black icon on a white card, a white icon on a near-black card). */
function luminanceOf(hex: string): number {
  const m = hex.replace("#", "");
  const full = m.length === 3 ? m.split("").map(c => c + c).join("") : m;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  if ([r, g, b].some(Number.isNaN)) return 0;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const ICON_DRAG_MIME = "application/x-futuraria-icon";

export function IconPicker({ anchorRect, onClose, onInsertIcon, onInsertIllustration, onInsertPhoto, onInsertSvg, insertError }: IconPickerProps) {
  const [tab, setTab] = useState<"icons" | "illustrations" | "photos" | "ai">("icons");
  const [library, setLibrary] = useState("phosphor");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [style, setStyle] = useState("regular");
  const [icons, setIcons] = useState<IconResult[]>([]);
  const [illustrations, setIllustrations] = useState<IllustrationResult[]>([]);
  const [photos, setPhotos] = useState<PhotoResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [color, setColor] = useState("#111111");
  const [size, setSize] = useState(48);
  const [unsplashKey, setUnsplashKey] = useState(() => {
    try { return localStorage.getItem(LS_UNSPLASH_KEY) || ""; } catch { return ""; }
  });
  const [photoError, setPhotoError] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── AI Generate state ──
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiInstructions, setAiInstructions] = useState("");
  const [aiResults, setAiResults] = useState<string[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiDraft, setAiDraft] = useState<string | null>(null);
  const aiAbortRef = useRef<AbortController | null>(null);

  const libDef = useMemo(() => LIBRARIES.find(l => l.value === library) || LIBRARIES[0], [library]);

  useEffect(() => { try { localStorage.setItem(LS_UNSPLASH_KEY, unsplashKey); } catch { /* private mode */ } }, [unsplashKey]);

  // Style must stay valid for whichever library is active (Lucide/Marcas
  // only have one; Tabler uses outline/filled, not Phosphor's 6 weights).
  useEffect(() => {
    if (!libDef.styles.some(s => s.value === style)) setStyle(libDef.styles[0].value);
  }, [libDef, style]);

  const searchIcons = async (lib: string, q: string, cat: string, sty: string) => {
    setLoading(true);
    try {
      const params: Record<string, string> = { library: lib, style: sty, limit: "40" };
      if (q.trim()) params.search = q.trim();
      if (cat !== "all" && lib !== "simple-icons" && lib !== "iconify") params.category = cat;
      const res = await apiFetch<any>(`/mcp`, {
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", method: "search_icons", params, id: 1 }),
      });
      const content = res?.result?.content?.[0];
      const data = content?.type === "text" && content.text ? JSON.parse(content.text) : null;
      setIcons(data?.icons || []);
    } catch {
      setIcons([]);
    }
    setLoading(false);
  };

  const searchIllustrations = async (q: string) => {
    setLoading(true);
    try {
      const params: Record<string, string> = { limit: "24" };
      if (q.trim()) params.search = q.trim();
      const res = await apiFetch<any>(`/mcp`, {
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", method: "search_illustrations", params, id: 1 }),
      });
      const content = res?.result?.content?.[0];
      const data = content?.type === "text" && content.text ? JSON.parse(content.text) : null;
      setIllustrations(data?.illustrations || []);
    } catch {
      setIllustrations([]);
    }
    setLoading(false);
  };

  // Unsplash is called straight from the browser with the user's own key —
  // it never passes through our backend, so their quota/terms stay theirs.
  const searchPhotos = async (q: string, key: string) => {
    if (!key) { setPhotos([]); return; }
    setLoading(true);
    setPhotoError("");
    try {
      const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q.trim() || "abstract")}&per_page=24`;
      const resp = await fetch(url, { headers: { Authorization: `Client-ID ${key}` } });
      if (!resp.ok) {
        setPhotoError(resp.status === 401 ? "La API key de Unsplash no es válida." : `Unsplash respondió ${resp.status}.`);
        setPhotos([]);
        setLoading(false);
        return;
      }
      const data = await resp.json();
      setPhotos((data?.results || []).map((p: any) => ({
        id: p.id,
        thumb: p.urls?.thumb,
        full: p.urls?.regular,
        alt: p.alt_description || p.description || "Foto",
        width: p.width, height: p.height,
        credit: { name: p.user?.name || "Unsplash", link: p.user?.links?.html || "https://unsplash.com" },
      })));
    } catch (e: any) {
      setPhotoError(e?.message || "No se pudo contactar Unsplash.");
      setPhotos([]);
    }
    setLoading(false);
  };

  const handleAiGenerate = async () => {
    if (!aiPrompt.trim() || aiLoading) return;
    setAiLoading(true);
    setAiResults([]);
    setAiDraft(null);

    const controller = streamGenerate(
      { prompt: aiPrompt.trim(), instructions: aiInstructions.trim() || undefined, n: 4 },
      {
        onEvent: (event: QuiverEvent) => {
          if (event.type === "draft") {
            setAiDraft(event.svg);
          } else if (event.type === "content") {
            setAiResults(prev => [...prev, event.svg].filter((v, i, a) => a.indexOf(v) === i));
            setAiDraft(null);
          }
        },
        onError: () => { setAiLoading(false); },
        onClose: () => { setAiLoading(false); setAiDraft(null); },
      },
    );
    aiAbortRef.current = controller;
  };

  // Debounced search — re-fires on tab/library/category/style change too,
  // since each of those changes which source is being queried.
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      if (tab === "icons") searchIcons(library, search, category, style);
      else if (tab === "illustrations") searchIllustrations(search);
      else if (tab === "photos") searchPhotos(search, unsplashKey);
      // "ai" tab doesn't auto-search — user presses Generate
    }, 250);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, library, search, category, style, unsplashKey]);

  const currentPayload = (icon: IconResult): IconPayload => ({
    library: icon.library, name: icon.name, style: icon.style, color, size,
  });

  const swatchBg = luminanceOf(color) > 0.6 ? "#1a1a1a" : "#ffffff";

  const panelStyle: React.CSSProperties = (() => {
    const width = 340;
    const maxHeight = Math.min(600, window.innerHeight - 32);
    if (!anchorRect) {
      return { position: "fixed", top: 60, left: 60, width, maxHeight, zIndex: 1000 };
    }
    const spaceRight = window.innerWidth - anchorRect.right;
    const openLeft = spaceRight < width + 16 && anchorRect.left > width + 16;
    const left = openLeft ? anchorRect.left - width - 8 : anchorRect.right + 8;
    const top = Math.min(Math.max(8, anchorRect.top), window.innerHeight - maxHeight - 8);
    return { position: "fixed", top, left, width, maxHeight, zIndex: 1000 };
  })();

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 999 }} />
      <div
        style={{
          ...panelStyle,
          display: "flex", flexDirection: "column",
          background: "var(--glass-bg, rgba(20,20,26,0.97))",
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
          border: "1px solid var(--glass-border, rgba(255,255,255,0.1))",
          borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,0.4)", overflow: "hidden",
        }}
      >
        {/* Header + tabs */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px 0" }}>
          <div style={{ display: "flex", gap: 2 }}>
            <button type="button" onClick={() => setTab("icons")} style={tabBtnStyle(tab === "icons")}>🔷 Iconos</button>
            <button type="button" onClick={() => setTab("illustrations")} style={tabBtnStyle(tab === "illustrations")}>🎨 Ilustr.</button>
            <button type="button" onClick={() => setTab("photos")} style={tabBtnStyle(tab === "photos")}>📷 Fotos</button>
            <button type="button" onClick={() => setTab("ai")} style={tabBtnStyle(tab === "ai")}>✦ AI</button>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: "transparent", border: "none", color: "#888", cursor: "pointer", fontSize: 16, padding: 4 }}>✕</button>
        </div>

        {tab === "icons" ? (
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, padding: 12, gap: 10 }}>
            {insertError && (
              <div style={{ padding: "6px 10px", borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", color: "#f87171", fontSize: 11.5 }}>
                {insertError}
              </div>
            )}

            {/* Library pills */}
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {LIBRARIES.map(l => (
                <button
                  key={l.value} type="button" onClick={() => setLibrary(l.value)}
                  style={{
                    padding: "4px 10px", borderRadius: 999, fontSize: 11, cursor: "pointer",
                    border: "1px solid " + (library === l.value ? "rgba(200,184,152,0.5)" : "rgba(255,255,255,0.1)"),
                    background: library === l.value ? "rgba(200,184,152,0.15)" : "rgba(255,255,255,0.04)",
                    color: library === l.value ? "#c8b898" : "#999",
                  }}
                >
                  {l.label}
                </button>
              ))}
            </div>

            <input
              type="text" placeholder="Buscar iconos…" value={search} onChange={e => setSearch(e.target.value)}
              style={{ padding: "8px 12px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#ccc", fontSize: 13, fontFamily: "inherit", outline: "none" }}
            />

            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {library !== "simple-icons" && (
                <select value={category} onChange={e => setCategory(e.target.value)} style={selectStyle}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              )}
              {libDef.styles.length > 1 && (
                <select value={style} onChange={e => setStyle(e.target.value)} style={selectStyle}>
                  {libDef.styles.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <label style={{ fontSize: 10.5, color: "#666" }}>Tamaño</label>
                <input
                  type="number" value={size} min={12} max={300}
                  onChange={e => setSize(parseInt(e.target.value) || 48)}
                  style={{ width: 46, padding: "6px 6px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "#ccc", fontSize: 12, fontFamily: "inherit", outline: "none", textAlign: "center" }}
                />
              </div>
              <input
                type="color" value={color} onChange={e => setColor(e.target.value)}
                style={{ width: 32, height: 32, border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, cursor: "pointer", background: "transparent", padding: 2 }}
              />
            </div>

            {/* Icon Grid */}
            <div style={{ flex: 1, overflowY: "auto", minHeight: 200 }}>
              {loading ? (
                <div style={{ textAlign: "center", color: "#555", padding: 40, fontSize: 12 }}>Cargando…</div>
              ) : icons.length === 0 ? (
                <div style={{ textAlign: "center", color: "#555", padding: 40, fontSize: 12 }}>Sin resultados</div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(78px, 1fr))", gap: 8 }}>
                  {icons.map(icon => (
                    <button
                      key={`${icon.library}-${icon.style}-${icon.name}`}
                      type="button"
                      draggable
                      onDragStart={e => {
                        e.dataTransfer.setData(ICON_DRAG_MIME, JSON.stringify(currentPayload(icon)));
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                      onClick={() => onInsertIcon(currentPayload(icon))}
                      title={icon.name}
                      style={{
                        display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
                        padding: "8px 4px", background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10,
                        cursor: "grab", transition: "background 0.15s ease, border-color 0.15s ease",
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(200,184,152,0.1)"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(200,184,152,0.3)"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.06)"; }}
                    >
                      {/* Contrast swatch: the icon is always rendered in the
                          user's chosen color, so a dark icon on this app's
                          dark panel (or a white icon picked deliberately)
                          would otherwise vanish — the card flips light/dark
                          based on the color's own luminance. */}
                      <div
                        style={{
                          width: 44, height: 44, borderRadius: 8, background: swatchBg,
                          display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
                        }}
                        dangerouslySetInnerHTML={{ __html: icon.svgPreview.replace("<svg ", `<svg width="28" height="28" style="color:${color}" `) }}
                      />
                      <span style={{ fontSize: 8.5, color: "#666", textAlign: "center", wordBreak: "break-all", lineHeight: 1.2 }}>
                        {icon.name.length > 13 ? icon.name.slice(0, 11) + "…" : icon.name}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div style={{ fontSize: 9.5, color: "#555", textAlign: "center" }}>
              Click para insertar · arrastrá al lienzo · {libDef.label} (MIT)
            </div>
          </div>
        ) : tab === "illustrations" ? (
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, padding: 12, gap: 10 }}>
            {insertError && (
              <div style={{ padding: "6px 10px", borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", color: "#f87171", fontSize: 11.5 }}>
                {insertError}
              </div>
            )}
            <input
              type="text" placeholder="Buscar ilustraciones…" value={search} onChange={e => setSearch(e.target.value)}
              style={{ padding: "8px 12px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#ccc", fontSize: 13, fontFamily: "inherit", outline: "none" }}
            />
            <div style={{ flex: 1, overflowY: "auto", minHeight: 200 }}>
              {loading ? (
                <div style={{ textAlign: "center", color: "#555", padding: 40, fontSize: 12 }}>Cargando…</div>
              ) : illustrations.length === 0 ? (
                <div style={{ textAlign: "center", color: "#555", padding: 40, fontSize: 12 }}>Sin resultados</div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
                  {illustrations.map(ill => (
                    <button
                      key={ill.slug}
                      type="button"
                      onClick={() => onInsertIllustration({ kind: "illustration", slug: ill.slug, title: ill.title, width: ill.width, height: ill.height })}
                      title={ill.title}
                      style={{
                        display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
                        padding: 6, background: "#ffffff",
                        border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, cursor: "pointer",
                      }}
                    >
                      <img src={ill.url} alt={ill.title} style={{ width: "100%", height: 76, objectFit: "contain" }} />
                      <span style={{ fontSize: 8.5, color: "#555", textAlign: "center", lineHeight: 1.2 }}>
                        {ill.title.length > 20 ? ill.title.slice(0, 18) + "…" : ill.title}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div style={{ fontSize: 9.5, color: "#555", textAlign: "center" }}>
              Click para insertar · unDraw (MIT, uso comercial libre)
            </div>
          </div>
        ) : tab === "ai" ? (
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, padding: 12, gap: 10 }}>
            <div style={{ fontSize: 11, color: "#888", lineHeight: 1.5 }}>
              Generá SVG con IA desde texto. Requiere una key de <strong style={{ color: "#a78bfa" }}>Quiver AI</strong> configurada en AI Settings.
            </div>
            <textarea
              placeholder="Describí el SVG que querés generar… (ej: 'unicornio minimalista, línea continua, una sola tinta')"
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
              rows={2}
              style={{ padding: "8px 12px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#ccc", fontSize: 13, fontFamily: "inherit", outline: "none", resize: "none" }}
            />
            <input
              type="text" placeholder="Instrucciones de estilo (opcional): flat, monocromo, rounded…"
              value={aiInstructions} onChange={e => setAiInstructions(e.target.value)}
              style={{ padding: "8px 12px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#ccc", fontSize: 12, fontFamily: "inherit", outline: "none" }}
            />
            <button
              type="button" onClick={handleAiGenerate} disabled={!aiPrompt.trim() || aiLoading}
              style={{
                padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, fontFamily: "inherit",
                border: "none", cursor: aiPrompt.trim() && !aiLoading ? "pointer" : "not-allowed",
                background: aiPrompt.trim() && !aiLoading ? "rgba(139,92,246,0.2)" : "rgba(255,255,255,0.04)",
                color: aiPrompt.trim() && !aiLoading ? "#c4b5fd" : "#555",
              }}
            >
              {aiLoading ? "✦ Generando…" : "✦ Generar SVG"}
            </button>
            {aiLoading && (
              <button type="button" onClick={() => { aiAbortRef.current?.abort(); setAiLoading(false); }}
                style={{ fontSize: 11, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.1)", color: "#f87171", borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontFamily: "inherit" }}>Cancelar</button>
            )}

            <div style={{ flex: 1, overflowY: "auto", minHeight: 160 }}>
              {/* Live draft preview while streaming */}
              {aiDraft && (
                <div style={{ marginBottom: 8, padding: 6, background: "rgba(255,255,255,0.97)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 80 }}>
                  <div style={{ width: "100%", maxWidth: 200 }} dangerouslySetInnerHTML={{ __html: aiDraft }} />
                </div>
              )}
              {aiResults.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
                  {aiResults.map((svg, i) => (
                    <button
                      key={i} type="button"
                      onClick={() => onInsertSvg?.(svg)}
                      style={{
                        padding: 6, background: "rgba(255,255,255,0.97)",
                        border: "1px solid rgba(139,92,246,0.2)", borderRadius: 10, cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center", minHeight: 80,
                      }}
                    >
                      <div style={{ width: "100%", maxWidth: 80 }} dangerouslySetInnerHTML={{ __html: svg }} />
                    </button>
                  ))}
                </div>
              )}
              {!aiLoading && aiResults.length === 0 && !aiDraft && (
                <div style={{ textAlign: "center", color: "#555", padding: 40, fontSize: 12 }}>
                  Escribí una descripción y presioná Generar.
                </div>
              )}
            </div>
            <div style={{ fontSize: 9.5, color: "#555", textAlign: "center" }}>
              ✦ Quiver AI · text-to-SVG · click para insertar
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, padding: 12, gap: 10 }}>
            {!unsplashKey ? (
              <div style={{ fontSize: 11.5, color: "#999", lineHeight: 1.6 }}>
                <p style={{ margin: "0 0 8px" }}>
                  Las fotos vienen de <strong style={{ color: "#c8b898" }}>Unsplash</strong>, que pide tu propia API key (gratis).
                </p>
                <ol style={{ margin: "0 0 10px", paddingLeft: 18 }}>
                  <li>Entrá a unsplash.com/developers y creá una cuenta.</li>
                  <li>"New Application" → aceptá los términos.</li>
                  <li>Copiá el <em>Access Key</em> y pegalo acá abajo.</li>
                </ol>
              </div>
            ) : null}
            <input
              type="password" placeholder="Unsplash Access Key" value={unsplashKey} onChange={e => setUnsplashKey(e.target.value)}
              style={{ padding: "8px 12px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#ccc", fontSize: 12, fontFamily: "inherit", outline: "none" }}
            />
            {unsplashKey && (
              <input
                type="text" placeholder="Buscar fotos…" value={search} onChange={e => setSearch(e.target.value)}
                style={{ padding: "8px 12px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#ccc", fontSize: 13, fontFamily: "inherit", outline: "none" }}
              />
            )}
            {photoError && (
              <div style={{ padding: "6px 10px", borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", color: "#f87171", fontSize: 11.5 }}>
                {photoError}
              </div>
            )}
            <div style={{ flex: 1, overflowY: "auto", minHeight: 160 }}>
              {!unsplashKey ? null : loading ? (
                <div style={{ textAlign: "center", color: "#555", padding: 40, fontSize: 12 }}>Cargando…</div>
              ) : photos.length === 0 ? (
                <div style={{ textAlign: "center", color: "#555", padding: 40, fontSize: 12 }}>Sin resultados</div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: 8 }}>
                  {photos.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => onInsertPhoto({ kind: "photo", url: p.full, alt: p.alt, width: p.width, height: p.height, credit: p.credit })}
                      title={`${p.alt} — © ${p.credit.name}`}
                      style={{ padding: 0, border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, cursor: "pointer", overflow: "hidden", background: "transparent" }}
                    >
                      <img src={p.thumb} alt={p.alt} style={{ width: "100%", height: 72, objectFit: "cover", display: "block" }} />
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div style={{ fontSize: 9.5, color: "#555", textAlign: "center" }}>
              Fotos de Unsplash · se acredita al autor automáticamente
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function tabBtnStyle(active: boolean): React.CSSProperties {
  return {
    padding: "6px 10px", borderRadius: "8px 8px 0 0", fontSize: 12, fontWeight: 600,
    cursor: "pointer", border: "none", borderBottom: active ? "2px solid #c8b898" : "2px solid transparent",
    background: active ? "rgba(200,184,152,0.08)" : "transparent",
    color: active ? "#c8b898" : "#888",
  };
}

const selectStyle: React.CSSProperties = {
  padding: "6px 8px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 6, color: "#ccc", fontSize: 11, fontFamily: "inherit", outline: "none", cursor: "pointer",
};
