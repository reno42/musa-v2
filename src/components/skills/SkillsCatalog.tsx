/** Vitrina de Skills (solo lectura) — "Lo que tu IA puede hacer por ti".
 *  Dos piezas: la card de entrada del Inicio (el usuario la tropieza, no la
 *  busca) y el catálogo full-screen estilo tienda: 9 cards, ficha por skill
 *  con pedidos copiables. Fuente de verdad: los SKILL.md de .agents/skills,
 *  vía /api/skills-catalog (Node) con fallback al JSON del prebuild (Workers).
 *  Sin edición: nada aquí escribe — la vitrina solo muestra y copia. */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type SkillEntry = {
  id: string;
  title: string;
  icon: string;
  description: string;
  examples: string[];
  method: string[] | null;
};
type CatalogPayload = { total: number; skills: SkillEntry[] };

/** Un fetch para la card y el modal (módulo vivo mientras la pestaña viva). */
let catalogCache: CatalogPayload | null = null;
async function fetchSkillsCatalog(): Promise<CatalogPayload> {
  if (catalogCache) return catalogCache;
  // REQ-048: 1) JSON estático del prebuild — existe en CF y en dev, y evita el
  // 404 garantizado de /api/skills-catalog en Workers (la API no tiene fs y
  // antes manchaba la consola en cada carga); 2) endpoint Node como fallback
  // (lee los SKILL.md en caliente).
  for (const url of ["/skills-catalog.json", "/api/skills-catalog"]) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const json: any = await res.json();
      const data = json?.data || json;
      if (data && Array.isArray(data.skills) && data.skills.length) {
        catalogCache = { total: data.total ?? data.skills.length, skills: data.skills };
        return catalogCache;
      }
    } catch { /* siguiente fuente */ }
  }
  throw new Error("No se pudo cargar el catálogo de habilidades");
}

// ── Iconos: el mismo vocabulario de trazo de la nav (24 viewBox, stroke 2,
//    caps redondos). design/flows/copy/contacts/config replican NAV_SECTIONS;
//    motion/photo/brands/social completan el set en el mismo estilo. ──
function SkillIcon(props: { icon: string; size?: number }) {
  const s = props.size ?? 18;
  const common = {
    width: s, height: s, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (props.icon) {
    case "design": // pen sobre lienzo (el de Diseño en la nav)
      return (<svg {...common}><path d="M12 19l7-7 3 3-7 7-3-3z" /><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" /><path d="M2 2l7.586 7.586" /><circle cx="11" cy="11" r="2" /></svg>);
    case "flows": // dos nodos y un bridge (el de Flows en la nav)
      return (<svg {...common}><circle cx="5" cy="6" r="2.2" /><circle cx="5" cy="18" r="2.2" /><rect x="14" y="9" width="7" height="6" rx="1.5" /><path d="M7 6c4 0 3 5 7 5" /><path d="M7 18c4 0 3-5 7-5" /></svg>);
    case "copy": // hoja de calendario con líneas (el de Copywriting)
      return (<svg {...common}><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>);
    case "contacts": // tres puntos conectados (el de Contactos)
      return (<svg {...common}><circle cx="6" cy="6" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="12" cy="18" r="2" /><line x1="7.5" y1="7.5" x2="11" y2="16" /><line x1="16.5" y1="7.5" x2="13" y2="16" /><line x1="8" y1="6" x2="16" y2="6" /></svg>);
    case "config": // engranaje (el de Configuración)
      return (<svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>);
    case "motion": // play dentro de marco (animación y video)
      return (<svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M10 9.5l5 2.5-5 2.5z" /></svg>);
    case "photo": // imagen con montaña y sol
      return (<svg {...common}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>);
    case "brands": // insignia (Tu marca)
      return (<svg {...common}><circle cx="12" cy="8" r="5" /><path d="M8.5 12.5L7 21l5-3 5 3-1.5-8.5" /></svg>);
    case "social": // burbuja de conversación
      return (<svg {...common}><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 8.5-8.5 8.38 8.38 0 0 1 8.5 8.5z" /></svg>);
    default:
      return (<svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 8v4l2.5 2.5" /></svg>);
  }
}

// ── Estilos locales (vocabulario visual del Inicio: cards frías, serif para
//    títulos, --accent champagne para el CTA) ──
const tileStyle: React.CSSProperties = {
  width: 38, height: 38, borderRadius: 10, flexShrink: 0,
  display: "flex", alignItems: "center", justifyContent: "center",
  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
  color: "rgba(255,255,255,0.85)",
};
const iaBadgeStyle: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, letterSpacing: 1, padding: "2px 7px", borderRadius: 100,
  border: "1px solid rgba(255,255,255,0.14)", background: "var(--accent-dim, rgba(255,255,255,0.06))",
  color: "var(--accent, rgba(255,255,255,0.8))",
};
const hoverIn = (el: HTMLElement) => {
  el.style.borderColor = "rgba(255,255,255,0.2)";
  el.style.boxShadow = "inset 0 1px 1px rgba(255,255,255,0.1), 0 16px 32px rgba(0,0,0,0.5)";
  el.style.transform = "translateY(-4px)";
};
const hoverOut = (el: HTMLElement) => {
  el.style.borderColor = "rgba(255,255,255,0.08)";
  el.style.boxShadow = "none";
  el.style.transform = "";
};

// ── Card de ENTRADA del Inicio: la vitrina existe aunque el catálogo tarde —
//    el contador se llena cuando aterriza el fetch (shell-first). ──
export function SkillsEntryCard() {
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<CatalogPayload | null>(catalogCache);
  useEffect(() => {
    if (catalogCache) return;
    let alive = true;
    fetchSkillsCatalog()
      .then(c => { if (alive) setCatalog(c); })
      .catch(() => { /* la card sigue servible sin contador */ });
    return () => { alive = false; };
  }, []);
  const total = catalog?.total ?? 9;
  const featured = (catalog?.skills || []).slice(0, 4);
  return (
    <>
      <div
        style={{
          ...{ background: "rgba(255,255,255,0.04)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", padding: "16px 18px" },
          display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", flexShrink: 0,
          cursor: "pointer",
        }}
        onMouseEnter={e => hoverIn(e.currentTarget)}
        onMouseLeave={e => hoverOut(e.currentTarget)}
        onClick={() => setOpen(true)}
        role="button"
        tabIndex={0}
        aria-label="Abrir catálogo de habilidades de tu IA"
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(true); } }}
      >
        {/* Racimo de iconos de módulo: la promesa visual en 1 línea. */}
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {(featured.length ? featured : [{ id: "ph1", icon: "design" }, { id: "ph2", icon: "flows" }, { id: "ph3", icon: "copy" }, { id: "ph4", icon: "contacts" }] as Array<{ id: string; icon: string }>).map(s => (
            <span key={s.id} style={{ ...tileStyle, width: 34, height: 34 }}><SkillIcon icon={s.icon} size={16} /></span>
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 19, color: "rgba(255,255,255,0.92)", lineHeight: 1.15 }}>
            Lo que tu IA puede hacer por ti
          </div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", marginTop: 2 }}>
            Conecta tu IA favorita a Musa y pídele todo esto directamente.
          </div>
          <div style={{ marginTop: 7, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={iaBadgeStyle}>IA</span>
            {catalog ? (
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)" }}>
                {total} habilidades · conecta tu IA vía MCP
              </span>
            ) : (
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>conecta tu IA vía MCP</span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={e => { e.stopPropagation(); setOpen(true); }}
          style={{
            borderRadius: 100, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 6,
            background: "var(--accent)", color: "#17151f", border: "1px solid var(--accent)",
          }}
        >
          Explorar habilidades
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
        </button>
      </div>
      {open ? <SkillsCatalogModal onClose={() => setOpen(false)} /> : null}
    </>
  );
}

// ── Chip copiable: el corazón del módulo — tocar, copiar, pegárselo a la IA. ──
function ExampleChip(props: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.text);
    } catch {
      // Clipboard API bloqueada (http no seguro): fallback clásico.
      const ta = document.createElement("textarea");
      ta.value = props.text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch { /* sin más fallback */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      type="button"
      onClick={copy}
      title="Click para copiar y pegárselo a tu IA"
      style={{
        display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
        background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 10, padding: "10px 12px", cursor: "pointer", font: "inherit",
        color: copied ? "var(--accent, #e8d5a3)" : "rgba(255,255,255,0.82)", fontSize: 13, lineHeight: 1.45,
      }}
    >
      <span style={{ flex: 1 }}>{props.text}</span>
      {copied ? (
        <span style={{ fontSize: 11, fontWeight: 600, flexShrink: 0, display: "flex", alignItems: "center", gap: 4 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>
          Copiado
        </span>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, opacity: 0.55 }}>
          <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

// ── Modal full-screen: grid de tienda + ficha de detalle (product page). ──
export function SkillsCatalogModal(props: { onClose: () => void }) {
  const [catalog, setCatalog] = useState<CatalogPayload | null>(catalogCache);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SkillEntry | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!catalogCache) {
      fetchSkillsCatalog().then(setCatalog).catch(e => setError(e?.message || "Error al cargar"));
    }
  }, []);
  // Esc cierra; el scroll de fondo se congela mientras el catálogo está abierto.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") props.onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Al entrar a una ficha, la ficha se lee desde arriba.
  useEffect(() => { if (panelRef.current) panelRef.current.scrollTop = 0; }, [detail]);

  return createPortal(
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(4,4,14,0.78)", backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
      }}
      onMouseDown={e => { if (e.target === e.currentTarget) props.onClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={detail ? `${detail.title}: habilidad de IA` : "Lo que tu IA puede hacer por ti"}
        style={{
          background: "#12121f", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16,
          width: "min(1060px, 100%)", maxHeight: "min(86vh, 900px)", overflowY: "auto",
          padding: "22px 24px 26px", position: "relative",
          boxShadow: "0 32px 80px rgba(0,0,0,0.6)",
        }}
      >
        {/* Cierre: esquina fija del panel, vivo en grid y en ficha. */}
        <button
          type="button" onClick={props.onClose} title="Cerrar (Esc)" aria-label="Cerrar catálogo"
          style={{
            position: "absolute", top: 14, right: 14, width: 30, height: 30, borderRadius: 100,
            display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
            background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
            color: "rgba(255,255,255,0.7)",
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>

        {!detail ? (
          <>
            {/* Encabezado de la vitrina */}
            <div style={{ maxWidth: 640, marginBottom: 18, paddingRight: 36 }}>
              <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 26, color: "rgba(255,255,255,0.94)", lineHeight: 1.15 }}>
                Lo que tu IA puede hacer por ti
              </div>
              <div style={{ fontSize: 13.5, color: "rgba(255,255,255,0.55)", marginTop: 5 }}>
                Conecta tu IA favorita a Musa y pídele todo esto directamente.
              </div>
            </div>

            {error ? (
              <div style={{ fontSize: 13, color: "#f87171", padding: "24px 0" }}>
                {error}
                <button type="button" onClick={() => { setError(null); fetchSkillsCatalog().then(setCatalog).catch(e2 => setError(e2?.message || "Error al cargar")); }}
                  style={{ marginLeft: 10, background: "none", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 6, color: "rgba(255,255,255,0.7)", fontSize: 12, padding: "3px 10px", cursor: "pointer" }}>
                  Reintentar
                </button>
              </div>
            ) : !catalog ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
                {Array.from({ length: 9 }, (_, i) => (
                  <div key={i} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 16 }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <div style={{ ...tileStyle, animation: "shimmer 1.4s linear infinite" }} />
                      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                        <div style={{ width: 90, height: 10, borderRadius: 6, animation: "shimmer 1.4s linear infinite", background: "rgba(255,255,255,0.06)" }} />
                        <div style={{ width: "70%", height: 8, borderRadius: 6, animation: "shimmer 1.4s linear infinite", background: "rgba(255,255,255,0.06)" }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
                {catalog.skills.map(skill => (
                  <div
                    key={skill.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${skill.title}: ver qué puedes pedirle`}
                    onClick={() => setDetail(skill)}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDetail(skill); } }}
                    onMouseEnter={e => hoverIn(e.currentTarget)}
                    onMouseLeave={e => hoverOut(e.currentTarget)}
                    style={{
                      background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 12, padding: 16, cursor: "pointer",
                      display: "flex", flexDirection: "column", gap: 10,
                      transition: "transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 11 }}>
                      <span style={tileStyle}><SkillIcon icon={skill.icon} /></span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 18, color: "rgba(255,255,255,0.92)", lineHeight: 1.2 }}>
                          {skill.title}
                        </div>
                      </div>
                      <span style={iaBadgeStyle}>IA</span>
                    </div>
                    <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.55)", lineHeight: 1.5, flex: 1 }}>
                      {skill.description}
                    </div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.38)" }}>
                      {skill.examples.length} pedidos listos para copiar
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            {/* Ficha de detalle — product page */}
            <button
              type="button"
              onClick={() => setDetail(null)}
              style={{
                background: "none", border: "none", color: "rgba(255,255,255,0.55)", fontSize: 13,
                cursor: "pointer", padding: 0, marginBottom: 14, display: "flex", alignItems: "center", gap: 5, font: "inherit",
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
              Todas las habilidades
            </button>

            {/* Hero: icono + título + description */}
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20, paddingRight: 36 }}>
              <span style={{ ...tileStyle, width: 52, height: 52, borderRadius: 14 }}><SkillIcon icon={detail.icon} size={26} /></span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 26, color: "rgba(255,255,255,0.94)", lineHeight: 1.1 }}>
                  {detail.title}
                </div>
                <div style={{ fontSize: 13.5, color: "rgba(255,255,255,0.55)", marginTop: 4, lineHeight: 1.5 }}>
                  {detail.description}
                </div>
              </div>
            </div>

            {/* Qué puedes pedirle — los pedidos accionables, copiables */}
            {detail.examples.length ? (
              <section style={{ marginBottom: 20 }}>
                <h3 style={{ fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: "rgba(255,255,255,0.5)", margin: "0 0 10px", fontWeight: 600 }}>
                  Qué puedes pedirle
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {detail.examples.map(ex => <ExampleChip key={ex} text={ex} />)}
                </div>
              </section>
            ) : null}

            {/* Cómo funciona — SOLO si el SKILL.md trae método apto para
                usuario; si es técnico, se omite (mejor vacío que crudo). */}
            {detail.method && detail.method.length ? (
              <section style={{ marginBottom: 20 }}>
                <h3 style={{ fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: "rgba(255,255,255,0.5)", margin: "0 0 10px", fontWeight: 600 }}>
                  Cómo funciona
                </h3>
                <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
                  {detail.method.map(line => (
                    <li key={line} style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 1.5 }}>{line}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {/* Footer: refuerza el concepto "esto lo hace tu agente" */}
            <div style={{
              borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 12,
              display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
            }}>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>Disponible para tu IA vía MCP</span>
              <span style={{ ...iaBadgeStyle, display: "inline-flex", alignItems: "center", gap: 5 }}>
                <SkillIcon icon={detail.icon} size={11} />
                {detail.title}
              </span>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
