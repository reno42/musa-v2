/**
 * PhotoLibraryPanel — REQ-PHOTO-PLATFORM-001 Fase 3 "Biblioteca".
 *
 * Grid tipo Library (Lightroom) sobre photo_catalog_items dentro del panel
 * izquierdo del Modo Foto: filtros de culling (texto, rating mínimo, flag),
 * rating y flag en línea vía PUT /api/photos/catalog (el MISMO upsert que
 * usa el visor y el MCP, con el assetId derivado igual) y abrir en el
 * visor. Estado local del panel: el padre solo recibe onOpenSrc(src).
 * Sin Supabase/migración v59 el GET falla y el panel degrada a las fotos
 * del diseño con un aviso visible.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { assetIdFromUrl, type PhotoTarget } from "../../shared/photoTargets.ts";

type PhotoFlag = "pick" | "reject" | "unflagged";

type CatalogItem = {
  asset_id: string;
  source_url: string | null;
  rating: number;
  flag: PhotoFlag;
  updated_at?: string;
};

type Row = CatalogItem & { inDesign: boolean };

const FLAG_LABEL: Record<PhotoFlag, string> = { pick: "P", reject: "R", unflagged: "—" };
const FLAG_COLOR: Record<PhotoFlag, string> = { pick: "#7dc98f", reject: "#d97a7a", unflagged: "#7a7668" };

const chip: React.CSSProperties = {
  fontSize: 10, padding: "2px 6px", borderRadius: 4,
  border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "#cfc8b8", cursor: "pointer",
};
const chipActive: React.CSSProperties = { ...chip, background: "#2a2620", borderColor: "#c8b898", color: "#e0d6c0" };

export function PhotoLibraryPanel(props: {
  workspaceId: string;
  targets: PhotoTarget[];
  onOpenSrc: (src: string) => void;
}) {
  const [items, setItems] = useState<CatalogItem[] | null>(null); // null = cargando
  const [warn, setWarn] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [minRating, setMinRating] = useState(0);
  const [flagFilter, setFlagFilter] = useState<"all" | PhotoFlag>("all");

  const load = useCallback(async () => {
    setWarn(null);
    try {
      const res = await apiFetch<any>(`/api/photos/catalog?workspaceId=${encodeURIComponent(props.workspaceId)}`);
      setItems(Array.isArray(res?.items) ? res.items : []);
    } catch (e: any) {
      setItems([]);
      setWarn(e?.message || "No se pudo cargar el catálogo");
    }
  }, [props.workspaceId]);

  useEffect(() => { void load(); }, [load]);

  // unión estable: items del catálogo primero, luego fotos del diseño sin item
  const rows = useMemo<Row[]>(() => {
    const list: Row[] = [];
    const seen = new Set<string>();
    const openable = new Set(props.targets.map(t => t.src));
    for (const it of items || []) {
      seen.add(it.source_url || it.asset_id);
      list.push({ ...it, inDesign: !!it.source_url && openable.has(it.source_url) });
    }
    for (const t of props.targets) {
      if (seen.has(t.src)) continue;
      list.push({ asset_id: assetIdFromUrl(t.src), source_url: t.src, rating: 0, flag: "unflagged", inDesign: true });
    }
    const needle = q.trim().toLowerCase();
    return list.filter(r =>
      (flagFilter === "all" || r.flag === flagFilter) &&
      r.rating >= minRating &&
      (!needle || (r.source_url || "").toLowerCase().includes(needle) || r.asset_id.toLowerCase().includes(needle)),
    );
  }, [items, props.targets, q, minRating, flagFilter]);

  const patchItem = async (row: Row, p: Partial<Pick<CatalogItem, "rating" | "flag">>) => {
    try {
      await apiFetch("/api/photos/catalog", {
        method: "PUT",
        body: JSON.stringify({
          workspaceId: props.workspaceId,
          assetId: row.asset_id,
          sourceUrl: row.source_url ?? undefined,
          ...p,
        }),
      });
    } catch { /* el reload siguiente pinta el estado real */ }
    void load();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <div style={{ padding: "6px 8px", borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", flexDirection: "column", gap: 4 }}>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Buscar por nombre o URL…"
          style={{ fontSize: 11, padding: "4px 6px", borderRadius: 4, border: "1px solid rgba(255,255,255,0.12)", background: "#161616", color: "#e0d6c0", outline: "none" }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
          {[0, 1, 2, 3, 4, 5].map(n => (
            <button key={n} type="button" title={n === 0 ? "Todas las valoraciones" : `Rating ≥ ${n}`}
              style={minRating === n ? chipActive : chip}
              onClick={() => setMinRating(n)}>{n === 0 ? "★∀" : `★${n}+`}</button>
          ))}
          <span style={{ width: 1, height: 12, background: "rgba(255,255,255,0.1)" }} />
          {(["all", "pick", "reject", "unflagged"] as const).map(f => (
            <button key={f} type="button" style={flagFilter === f ? chipActive : chip} onClick={() => setFlagFilter(f)}>
              {f === "all" ? "Todos" : FLAG_LABEL[f]}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 10, color: "#7a7668", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{items === null ? "Cargando…" : `${rows.length} ítem${rows.length === 1 ? "" : "s"}`}</span>
          <button type="button" style={chip} onClick={() => void load()}>↻ Actualizar</button>
        </div>
        {warn && <div style={{ fontSize: 10, color: "#d9a05a" }}>{warn}</div>}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, alignContent: "start" }}>
        {rows.map(r => {
          const thumb = r.source_url || "";
          return (
            <div key={`${r.asset_id}:${r.source_url || ""}`} style={{ background: "#141414", borderRadius: 4, overflow: "hidden", border: "1px solid rgba(255,255,255,0.06)" }}>
              <button type="button" disabled={!r.inDesign}
                title={r.inDesign ? "Abrir en el visor" : "Esta foto no está en el diseño actual"}
                onClick={() => { if (r.inDesign && thumb) props.onOpenSrc(thumb); }}
                style={{ display: "block", width: "100%", padding: 0, border: "none", background: "#101010", cursor: r.inDesign ? "pointer" : "default", opacity: r.inDesign ? 1 : 0.45 }}>
                {thumb ? (
                  <img src={thumb} alt={r.asset_id} loading="lazy" draggable={false}
                    style={{ width: "100%", height: 64, objectFit: "cover", display: "block" }} />
                ) : (
                  <div style={{ height: 64, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#7a7668" }}>sin URL</div>
                )}
              </button>
              <div style={{ padding: "4px 5px" }}>
                <div title={r.asset_id} style={{ fontSize: 9, color: "#b5ad9c", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 3 }}>{r.asset_id}</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ display: "flex", gap: 1 }}>
                    {[1, 2, 3, 4, 5].map(n => (
                      <button key={n} type="button" title={`Rating ${n}`}
                        style={{ fontSize: 10, lineHeight: 1, padding: 0, border: "none", background: "transparent", cursor: "pointer", color: n <= r.rating ? "#e0b34c" : "#4a463d" }}
                        onClick={() => void patchItem(r, { rating: n === r.rating ? 0 : n })}>★</button>
                    ))}
                  </span>
                  <button type="button" title="Pick / Reject / sin bandera"
                    style={{ fontSize: 10, lineHeight: 1, padding: "1px 4px", borderRadius: 3, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", cursor: "pointer", color: FLAG_COLOR[r.flag] }}
                    onClick={() => void patchItem(r, { flag: r.flag === "unflagged" ? "pick" : r.flag === "pick" ? "reject" : "unflagged" })}>
                    {FLAG_LABEL[r.flag]}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        {rows.length === 0 && items !== null && (
          <div style={{ gridColumn: "1 / -1", fontSize: 10, color: "#7a7668", textAlign: "center", padding: "18px 6px" }}>
            Sin fotos que coincidan con el filtro. Valora una foto en el visor (★ / P) y aparecerá aquí.
          </div>
        )}
      </div>
    </div>
  );
}
