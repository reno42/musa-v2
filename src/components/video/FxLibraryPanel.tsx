/**
 * FxLibraryPanel — V5 "Biblioteca" section for the Video Mode's left panel
 * (plan Fase 3): one place with tabs Transiciones | Efectos | Filtros | Texto
 * over the shared effects catalog, with search + shared favorites
 * (localStorage `futuraria.favFx`). Everything applies to the CURRENT
 * selection — the transition of the take under the playhead (or the selected
 * take), the selected layer, the selected take's look, the selected caption.
 *
 * PURE UI: all writes ride the same handlers the inspector uses
 * (onTransitionChange / onFrameReelFilterChange / applyLayerEffect /
 * onTextChange), so preview, export and undo behave identically.
 */

import { useMemo, useState } from "react";
import {
  LOOKS, LAYER_EFFECTS, TEXT_ANIMS, type TextAnimId,
} from "../../../shared/videoEffectsCatalog.ts";
import { takeStartSec, type ReelTimeline } from "../../lib/sequencePlayback";
import type { VideoTimelineDoc } from "../../lib/videoTimelineDoc";
import type { FrameData } from "../DesignFrame";
import type { TimelineSelection } from "./VideoTimeline";
import { TransitionLibrary, type TransitionPick } from "./TransitionLibrary";

export interface FxLibraryPanelProps {
  selection: TimelineSelection | null;
  /** Takes in reel order (included[i] == tl.takes[i]). */
  included: FrameData[];
  doc: VideoTimelineDoc;
  tl: ReelTimeline;
  /** Playhead — resolves the "boundary bajo el playhead" target. */
  tSec: number;
  onTransitionApply: (fromFrameId: string, toFrameId: string, pick: TransitionPick) => void;
  onTransitionRemove: (fromFrameId: string, toFrameId: string) => void;
  onLookApply: (frameId: string, filter: string) => void;
  onLayerEffectApply: (frameId: string, layerId: string, effectId: string) => void;
  onTextAnimApply: (clipId: string, anim: TextAnimId) => void;
  addToast: (msg: string, kind?: "success" | "error" | "info") => void;
}

// ── Shared favorites (plan: localStorage compartido futuraria.favFx) ──
type FavFx = { looks: string[]; fx: string[]; anims: string[] };
const FAV_FX_KEY = "futuraria.favFx";
function readFavFx(): FavFx {
  try {
    const raw = JSON.parse(localStorage.getItem(FAV_FX_KEY) || "{}") as Partial<FavFx>;
    return {
      looks: Array.isArray(raw.looks) ? raw.looks : [],
      fx: Array.isArray(raw.fx) ? raw.fx : [],
      anims: Array.isArray(raw.anims) ? raw.anims : [],
    };
  } catch { return { looks: [], fx: [], anims: [] }; }
}
function writeFavFx(f: FavFx) {
  try { localStorage.setItem(FAV_FX_KEY, JSON.stringify(f)); } catch { /* private mode */ }
}

// ── Local idiom (mirrors VideoMediaPanel) ──
const muted: React.CSSProperties = { fontSize: 10, lineHeight: 1.5, color: "#7a7668" };
const chip: React.CSSProperties = {
  fontSize: 10, padding: "3px 6px", borderRadius: 3, textAlign: "left",
  border: "1px solid rgba(200,184,152,0.15)", background: "rgba(200,184,152,0.05)",
  color: "#c8b898", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 4,
};
const chipActive: React.CSSProperties = { borderColor: "rgba(200,184,152,0.6)", background: "rgba(200,184,152,0.14)" };
const tabBtn: React.CSSProperties = {
  ...chip, flex: 1, justifyContent: "center", padding: "3px 2px",
};
const searchInput: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", fontSize: 10, padding: "3px 6px", borderRadius: 3,
  border: "1px solid rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.3)", color: "#f0ebe0", fontFamily: "inherit",
};
const star = (on: boolean): React.CSSProperties => ({ ...chip, padding: "3px 4px", color: on ? "#e0b57a" : "#5a564a" });

/** Last take whose global start ≤ t — during a transition slot this is the
 *  FROM take, which is exactly the transition the playhead sits in. */
function takeIndexAt(tl: ReelTimeline, t: number): number {
  let idx = 0;
  for (let i = 0; i < tl.takes.length; i++) {
    if (t >= takeStartSec(tl, i) - 1e-9) idx = i;
  }
  return idx;
}

type Tab = "trans" | "fx" | "looks" | "text";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "trans", label: "Transic." },
  { id: "fx", label: "Efectos" },
  { id: "looks", label: "Filtros" },
  { id: "text", label: "Texto" },
];

export function FxLibraryPanel({
  selection, included, doc, tl, tSec,
  onTransitionApply, onTransitionRemove, onLookApply, onLayerEffectApply, onTextAnimApply, addToast,
}: FxLibraryPanelProps) {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<Tab>("looks");
  const [query, setQuery] = useState("");
  const [fav, setFav] = useState<FavFx>(readFavFx);
  // Look intensity (Filtros) — re-applies live while a look is active.
  const [lookIntensity, setLookIntensity] = useState(1);

  const toggleFav = (list: keyof FavFx, id: string) => {
    setFav(prev => {
      const next: FavFx = { ...prev, [list]: prev[list].includes(id) ? prev[list].filter(x => x !== id) : [...prev[list], id] };
      writeFavFx(next);
      return next;
    });
  };

  // ── Targets ──
  const selTakeIdx = selection?.kind === "take"
    ? included.findIndex(f => f.id === selection.frameId)
    : takeIndexAt(tl, tSec);
  const takeFrame = selTakeIdx >= 0 ? included[selTakeIdx] : undefined;
  const nextFrame = selTakeIdx >= 0 ? included[selTakeIdx + 1] : undefined;
  const layerSel = selection?.kind === "layer" ? selection : null;
  const textSel = selection?.kind === "text" ? doc.textClips.find(c => c.id === selection.clipId) ?? null : null;

  // Active look = exact-match reverse sweep (same contract as LookPicker).
  const activeLook = useMemo(() => {
    const cur = takeFrame?.reelFilter;
    if (!cur) return null;
    for (const look of LOOKS) {
      for (let q = 0; q <= 20; q++) {
        if (look.css(q / 20) === cur) return { id: look.id, intensity: q / 20 };
      }
    }
    return null;
  }, [takeFrame?.reelFilter]);

  const q = query.trim().toLowerCase();
  const hit = (label: string, id: string) => !q || label.toLowerCase().includes(q) || id.toLowerCase().includes(q);
  const favFirst = (id: string, list: keyof FavFx) => (fav[list].includes(id) ? 0 : 1);

  const applyLook = (lookId: string, intensity: number) => {
    const look = LOOKS.find(l => l.id === lookId);
    if (!look || !takeFrame) return;
    onLookApply(takeFrame.id, look.css(intensity));
    addToast(`Look «${look.label}» → toma ${takeFrame.name}`, "success");
  };

  return (
    <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <button type="button" onClick={() => setOpen(o => !o)}
          style={{ ...chip, padding: "1px 5px", background: "transparent", border: "none", fontSize: 11 }}>
          {open ? "▾" : "▸"}
        </button>
        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "#9a968a", flex: 1 }}>
          Biblioteca FX
        </div>
      </div>

      {open && (
        <>
          <div style={{ display: "flex", gap: 3, marginBottom: 6 }}>
            {TABS.map(t => (
              <button key={t.id} type="button" onClick={() => setTab(t.id)}
                style={{ ...tabBtn, ...(tab === t.id ? chipActive : null) }}>
                {t.label}
              </button>
            ))}
          </div>

          {/* ── Transiciones: boundary of the take under the playhead ── */}
          {tab === "trans" && (
            !takeFrame || !nextFrame ? (
              <div style={muted}>Sin toma siguiente — la transición va en una toma que tenga otra después en el reel.</div>
            ) : (
              <>
                <div style={{ ...muted, marginBottom: 4 }}>
                  Transición de «{takeFrame.name}» → «{nextFrame.name}»
                </div>
                <TransitionLibrary
                  current={(() => {
                    const tr = takeFrame.animation?.transitions?.find(t => t.toFrameId === nextFrame.id);
                    return tr ? { type: tr.type, durationSec: tr.durationSec, params: tr.params } : null;
                  })()}
                  onApply={pick => { onTransitionApply(takeFrame.id, nextFrame.id, pick); addToast(`Transición aplicada: ${pick.type}`, "success"); }}
                  onRemove={() => { onTransitionRemove(takeFrame.id, nextFrame.id); addToast("Transición quitada (corte seco)", "info"); }}
                />
              </>
            )
          )}

          {/* ── Efectos de capa: needs a layer selection ── */}
          {tab === "fx" && (
            !layerSel ? (
              <div style={muted}>Selecciona una capa en el timeline (V track) para aplicarle un efecto.</div>
            ) : (
              <>
                <input style={{ ...searchInput, marginBottom: 5 }} placeholder="Buscar efecto…" value={query} onChange={e => setQuery(e.target.value)} />
                <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                  {[...LAYER_EFFECTS].sort((a, b) => favFirst(a.id, "fx") - favFirst(b.id, "fx")).map(eff => (
                    hit(eff.label, eff.id) && (
                      <span key={eff.id} style={{ display: "flex" }}>
                        <button type="button" title={`Aplicar «${eff.label}» a la capa`}
                          onClick={() => { onLayerEffectApply(layerSel.frameId, layerSel.layerId, eff.id); addToast(`Efecto «${eff.label}» aplicado`, "success"); }}
                          style={chip}>
                          {fav.fx.includes(eff.id) ? "★" : ""} {eff.label}
                        </button>
                        <button type="button" title={fav.fx.includes(eff.id) ? "Quitar de favoritos" : "Favorito"}
                          onClick={() => toggleFav("fx", eff.id)} style={star(fav.fx.includes(eff.id))}>★</button>
                      </span>
                    )
                  ))}
                </div>
                <div style={{ ...muted, marginTop: 4, fontSize: 9 }}>Reemplaza las props del efecto en los clips de la capa.</div>
              </>
            )
          )}

          {/* ── Filtros (looks) sobre la toma activa ── */}
          {tab === "looks" && (
            !takeFrame ? (
              <div style={muted}>Sin toma activa.</div>
            ) : (
              <>
                <div style={{ ...muted, marginBottom: 4 }}>
                  Look de «{takeFrame.name}»{activeLook ? ` — activo: ${activeLook.id} @${Math.round(activeLook.intensity * 100)}%` : " — Original"}
                </div>
                <input style={{ ...searchInput, marginBottom: 5 }} placeholder="Buscar look…" value={query} onChange={e => setQuery(e.target.value)} />
                <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                  {[...LOOKS].sort((a, b) => favFirst(a.id, "looks") - favFirst(b.id, "looks")).map(look => (
                    hit(look.label, look.id) && (
                      <span key={look.id} style={{ display: "flex" }}>
                        <button type="button" title={`Aplicar look «${look.label}»`}
                          onClick={() => applyLook(look.id, lookIntensity)}
                          style={{ ...chip, ...(activeLook?.id === look.id ? chipActive : null) }}>
                          {fav.looks.includes(look.id) ? "★" : ""} {look.label}
                        </button>
                        <button type="button" title={fav.looks.includes(look.id) ? "Quitar de favoritos" : "Favorito"}
                          onClick={() => toggleFav("looks", look.id)} style={star(fav.looks.includes(look.id))}>★</button>
                      </span>
                    )
                  ))}
                </div>
                {activeLook && activeLook.id !== "none" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5 }}>
                    <span style={{ ...muted, flexShrink: 0 }}>Intensidad</span>
                    <input type="range" min={0} max={100} step={5} value={Math.round(lookIntensity * 100)}
                      onChange={e => {
                        const v = parseInt(e.target.value, 10) / 100;
                        setLookIntensity(v);
                        if (activeLook) applyLook(activeLook.id, v);
                      }}
                      style={{ flex: 1, accentColor: "#c8b898" }} />
                    <span style={{ ...muted, width: 26, textAlign: "right" }}>{Math.round(lookIntensity * 100)}%</span>
                  </div>
                )}
              </>
            )
          )}

          {/* ── Texto: anims del caption seleccionado ── */}
          {tab === "text" && (
            !textSel ? (
              <div style={muted}>Selecciona un clip de texto en el timeline para cambiarle la animación.</div>
            ) : (
              <>
                <div style={{ ...muted, marginBottom: 4 }}>Anim de «{textSel.text.replace(/\n/g, " ").slice(0, 24)}»</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                  {[...TEXT_ANIMS].sort((a, b) => favFirst(a.id, "anims") - favFirst(b.id, "anims")).map(a => (
                    hit(a.label, a.id) && (
                      <span key={a.id} style={{ display: "flex" }}>
                        <button type="button" title={`Anim «${a.label}»`}
                          onClick={() => { onTextAnimApply(textSel.id, a.id); addToast(`Anim «${a.label}» aplicada`, "success"); }}
                          style={{ ...chip, ...(textSel.anim === a.id ? chipActive : null) }}>
                          {fav.anims.includes(a.id) ? "★" : ""} {a.label}
                        </button>
                        <button type="button" title={fav.anims.includes(a.id) ? "Quitar de favoritos" : "Favorito"}
                          onClick={() => toggleFav("anims", a.id)} style={star(fav.anims.includes(a.id))}>★</button>
                      </span>
                    )
                  ))}
                </div>
              </>
            )
          )}
        </>
      )}
    </div>
  );
}
