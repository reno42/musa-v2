/**
 * TransitionLibrary — the V5 categorized transition browser (CapCut-style).
 * Family chips + searchable tile grid + Favoritas/Recientes (localStorage)
 * + per-transition param controls (from the catalog's ParamDefs) + duration.
 *
 * PURE UI over shared/videoEffectsCatalog.ts: the caller persists
 * {type, durationSec, params} through onApply (→ onTransitionChange). The
 * hover micro-animations are decorative previews of each FAMILY's motif,
 * keyed on hover only so idle timelines stay cheap.
 */

import { useEffect, useMemo, useState } from "react";
import {
  TRANSITIONS,
  TRANSITION_FAMILIES,
  transitionDef,
  type TransitionDef,
  type TransitionFamily,
  type TransitionParamDef,
  type TransitionParams,
} from "../../../shared/videoEffectsCatalog.ts";

export interface TransitionPick {
  type: string;
  durationSec: number;
  params?: TransitionParams;
}

export interface TransitionLibraryProps {
  /** The take's current outgoing transition (null = corte seco). */
  current: { type: string; durationSec: number; params?: TransitionParams } | null;
  onApply: (pick: TransitionPick) => void;
  onRemove?: () => void;
}

const FAV_KEY = "futuraria.favTransitions";
const REC_KEY = "futuraria.recentTransitions";

function readIds(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(v) ? v.filter((x: unknown): x is string => typeof x === "string") : [];
  } catch { return []; }
}
function writeIds(key: string, ids: string[], cap: number) {
  try { localStorage.setItem(key, JSON.stringify(ids.slice(0, cap))); } catch { /* private mode */ }
}

/** Recent = the vocabulary for "Recientes" — call on every apply. */
export function noteTransitionUsed(id: string) {
  writeIds(REC_KEY, [id, ...readIds(REC_KEY).filter(x => x !== id)], 8);
}

const btn: React.CSSProperties = {
  fontSize: 9, padding: "2px 6px", borderRadius: 3,
  border: "1px solid rgba(200,184,152,0.15)", background: "rgba(200,184,152,0.05)",
  color: "#c8b898", cursor: "pointer", fontFamily: "inherit",
};
const activeBtn = { borderColor: "rgba(200,184,152,0.6)", background: "rgba(200,184,152,0.14)" };
const muted: React.CSSProperties = { fontSize: 9, lineHeight: 1.4, color: "#7a7668" };

/* Hover micro-animation, one motif per family (decorative previews). */
const LIB_CSS = `
@keyframes v5lib-basic { from { opacity: 0.15 } to { opacity: 1 } }
@keyframes v5lib-camera { 0% { transform: scale(1) } 55% { transform: scale(1.22) } 100% { transform: scale(1) } }
@keyframes v5lib-blur { from { filter: blur(3.5px); transform: translateX(-4px) } to { filter: blur(0); transform: none } }
@keyframes v5lib-light { 0% { opacity: 0.25; filter: brightness(3) } 100% { opacity: 1; filter: brightness(1) } }
@keyframes v5lib-overlay { from { clip-path: circle(0% at 50% 50%) } to { clip-path: circle(85% at 50% 50%) } }
@keyframes v5lib-mg { 0% { transform: translateX(-3px) } 25% { transform: translateX(3px) } 50% { transform: translateX(-2px) } 75% { transform: translateX(2px) } 100% { transform: none } }
.v5lib-tile:hover .v5lib-prev { animation: v5lib-FAMILY 0.9s ease-in-out infinite; }
.v5lib-fav { opacity: 0; }
.v5lib-tile:hover .v5lib-fav, .v5lib-fav[data-on="1"] { opacity: 1; }
`;

const FAMILY_ANIM: Record<TransitionFamily, string> = {
  basic: "v5lib-basic", camera: "v5lib-camera", blur: "v5lib-blur",
  light: "v5lib-light", overlay: "v5lib-overlay", mg: "v5lib-mg",
};

type Bucket = "all" | "fav" | "recent" | TransitionFamily;

export function TransitionLibrary({ current, onApply, onRemove }: TransitionLibraryProps) {
  const [bucket, setBucket] = useState<Bucket>("all");
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState<string | null>(current?.type ?? null);
  const [dur, setDur] = useState<number>(current?.durationSec ?? 0.6);
  const [params, setParams] = useState<TransitionParams>(current?.params ?? {});
  const [favVer, setFavVer] = useState(0); // bump to re-read localStorage

  // Re-sync the draft when a different transition gets selected.
  useEffect(() => {
    if (!sel) return;
    const def = transitionDef(sel);
    setDur(current?.type === sel ? current.durationSec : def?.durationSec ?? 0.6);
    setParams(current?.type === sel ? { ...(current.params ?? {}) } : {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);

  const favs = useMemo(() => new Set(readIds(FAV_KEY)), [favVer]);
  const recents = useMemo(() => readIds(REC_KEY), [favVer]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list: readonly TransitionDef[] = TRANSITIONS;
    if (bucket === "fav") list = list.filter(t => favs.has(t.id));
    else if (bucket === "recent") {
      const order = new Map(recents.map((id, i) => [id, i]));
      list = list.filter(t => order.has(t.id)).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    } else if (bucket !== "all") list = list.filter(t => t.family === bucket);
    if (q) list = list.filter(t => t.label.toLowerCase().includes(q) || t.id.includes(q));
    return list;
  }, [bucket, query, favs, recents]);

  const selDef = sel ? transitionDef(sel) : null;

  const toggleFav = (id: string) => {
    const next = favs.has(id) ? [...favs].filter(x => x !== id) : [...favs, id];
    writeIds(FAV_KEY, next, 100);
    setFavVer(v => v + 1);
  };

  const apply = () => {
    if (!selDef) return;
    noteTransitionUsed(selDef.id);
    onApply({ type: selDef.id, durationSec: Math.min(5, Math.max(0.1, dur)), params });
  };

  const setParam = (def: TransitionParamDef, v: number | string) => setParams(p => ({ ...p, [def.key]: v }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
      <style>{LIB_CSS}</style>

      {/* Search + buckets */}
      <input value={query} placeholder="Buscar transición…"
        onChange={e => setQuery(e.target.value)}
        style={{ width: "100%", boxSizing: "border-box", background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.08)", color: "#f0ebe0", borderRadius: 4, padding: "3px 6px", fontSize: 10, fontFamily: "inherit" }} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
        {([["all", "Todas", "▦"], ["fav", "Favoritas", "★"], ["recent", "Recientes", "⟲"]] as const).map(([id, label, icon]) => (
          <button key={id} type="button" onClick={() => setBucket(id)}
            style={{ ...btn, ...(bucket === id ? activeBtn : null) }}>{icon} {label}</button>
        ))}
        {TRANSITION_FAMILIES.map(f => (
          <button key={f.id} type="button" title={f.label} onClick={() => setBucket(f.id)}
            style={{ ...btn, padding: "2px 5px", ...(bucket === f.id ? activeBtn : null) }}>{f.icon}</button>
        ))}
      </div>

      {/* Tile grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 3, maxHeight: 190, overflowY: "auto" }}>
        {shown.map(t => {
          const active = current?.type === t.id || sel === t.id;
          return (
            <div key={t.id} className="v5lib-tile" style={{ position: "relative" }}>
              <button type="button" title={`${t.label} (${t.id})`}
                onClick={() => setSel(t.id)}
                style={{
                  ...btn, width: "100%", display: "flex", alignItems: "center", gap: 4, padding: "3px 4px",
                  ...(active ? activeBtn : null),
                }}>
                <span className="v5lib-prev" style={{ fontSize: 12, lineHeight: 1 }}>{t.icon}</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, textAlign: "left" }}>{t.label}</span>
              </button>
              <button type="button" data-on={favs.has(t.id) ? "1" : "0"} className="v5lib-fav" title="Favorita"
                onClick={e => { e.stopPropagation(); toggleFav(t.id); }}
                style={{
                  position: "absolute", top: -4, right: -3, fontSize: 9, lineHeight: 1, padding: 1,
                  color: favs.has(t.id) ? "#e0b57a" : "#7a7668", background: "transparent",
                  border: "none", cursor: "pointer",
                }}>{favs.has(t.id) ? "★" : "☆"}</button>
            </div>
          );
        })}
        {shown.length === 0 && <div style={{ ...muted, gridColumn: "1 / -1" }}>Sin resultados.</div>}
      </div>

      {/* Selected transition: params + duration + apply */}
      {selDef && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 5, display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 10, color: "#c8b898" }}>{selDef.icon} {selDef.label}</div>
          {(selDef.params ?? []).map(def => (
            <div key={def.key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ ...muted, width: 52, flexShrink: 0 }}>{def.label}</span>
              {def.type === "number" && (
                <>
                  <input type="range" min={def.min} max={def.max} step={def.step}
                    value={typeof params[def.key] === "number" ? (params[def.key] as number) : def.default}
                    onChange={e => setParam(def, parseFloat(e.target.value) || def.default)}
                    style={{ flex: 1, accentColor: "#c8b898" }} />
                  <span style={{ ...muted, width: 28, textAlign: "right" }}>
                    {Math.round((typeof params[def.key] === "number" ? (params[def.key] as number) : def.default) * 100) / 100}
                  </span>
                </>
              )}
              {def.type === "enum" && (
                <select value={typeof params[def.key] === "string" ? (params[def.key] as string) : def.default}
                  onChange={e => setParam(def, e.target.value)}
                  style={{ flex: 1, background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.08)", color: "#f0ebe0", borderRadius: 4, padding: "2px 4px", fontSize: 10, fontFamily: "inherit" }}>
                  {def.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              )}
              {def.type === "color" && (
                <input type="color" value={typeof params[def.key] === "string" ? (params[def.key] as string) : def.default}
                  onChange={e => setParam(def, e.target.value)}
                  style={{ width: 26, height: 18, padding: 0, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", cursor: "pointer" }} />
              )}
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ ...muted, flex: 1 }}>Duración</span>
            <input type="number" min={0.1} max={5} step={0.1} value={dur}
              onChange={e => setDur(clampDur(parseFloat(e.target.value)))}
              style={{ width: 46, background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.08)", color: "#f0ebe0", borderRadius: 4, padding: "2px 5px", fontSize: 10, fontFamily: "monospace" }} />
            <span style={muted}>s</span>
            <button type="button" onClick={apply} style={{ ...btn, ...activeBtn, padding: "3px 10px" }}>Aplicar</button>
          </div>
          {current?.type === selDef.id && onRemove && (
            <button type="button" onClick={onRemove} style={{ ...btn, color: "#e07a7a", borderColor: "rgba(224,122,122,0.3)" }}>
              Quitar transición (corte seco)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const clampDur = (v: number) => Math.min(5, Math.max(0.1, Number.isFinite(v) ? v : 0.6));
