/**
 * BrandGraphDataTable — the brand graph as a plain spreadsheet.
 *
 * Three columns, black and white, no icons: Marca · Categoria · Archivo.
 * Click rows to select (shift for a range, ctrl/cmd to toggle), press Delete
 * to remove them. Double-click a cell to edit it.
 *
 * Every cell writes through to a real column and the row redraws from the
 * server afterwards, so what the table shows is what the graph will draw:
 *   Marca     → design_file_meta.brand_id (the name is resolved to a brand,
 *               and a name nobody uses yet creates one)
 *   Categoria → design_file_meta.category (v21)
 *   Archivo   → templates.name
 * Writes that fail say so in the toolbar. They used to go to console.error
 * only, which is why every one of these columns felt inert rather than broken.
 *
 * Hover is CSS, not React state. An earlier version tracked the hovered row in
 * state, so every mouse move re-rendered all ~400 rows — that was the flicker,
 * the hang, and why typing appeared to do nothing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { notifyMetaChanged, onMetaChanged } from "../lib/metaSync";

interface GraphNode {
  id: string;
  name: string;
  kind: string;
  category?: string;
  templateId?: string;
  ghost?: boolean;
  children: GraphNode[];
}

interface GraphRoot {
  brands: GraphNode[];
  orphans?: GraphNode[];
}

/** One file. Brand and category are the branch it hangs from.
 *  A row with no templateId is a brand that owns no files — listed so it can
 *  be seen and deleted, since the graph shows it but the file list cannot. */
interface Row {
  id: string;
  templateId: string;
  brandId: string;
  brandName: string;
  category: string;
  name: string;
  /** True for a brand placeholder rather than a real file. */
  brandOnly?: boolean;
}

interface Brand {
  id: string;
  name: string;
}

interface Props {
  workspaceId: string | null;
  onOpenTemplate?: (templateId: string) => void;
  onRefreshGraph?: () => void;
}

/** The four branches a brand hangs off in the graph. */
const CATEGORIES = ["Design System", "Plantillas", "Assets", "Archivos"];

const CELL: React.CSSProperties = {
  padding: "7px 14px",
  borderRight: "1px solid rgba(255,255,255,0.10)",
  borderBottom: "1px solid rgba(255,255,255,0.10)",
  fontSize: 13,
  color: "#fff",
  textAlign: "left",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const btn: React.CSSProperties = {
  padding: "5px 12px", fontSize: 12, fontFamily: "inherit",
  color: "#fff", background: "transparent",
  border: "1px solid rgba(255,255,255,0.35)", borderRadius: 0, cursor: "pointer",
};

const control: React.CSSProperties = {
  padding: "5px 10px", fontSize: 12, fontFamily: "inherit",
  color: "#fff", background: "#000",
  border: "1px solid rgba(255,255,255,0.35)", borderRadius: 0, cursor: "pointer",
};

/** Long enough to read as a movement, short enough not to be a wait. */
const ROW_EXIT_MS = 240;
const ROW_FLASH_MS = 700;

const TABLE_CSS = `
.bgt tbody tr:hover td { background: rgba(255,255,255,0.06); }

/* In flight: the row dims rather than being replaced, so the value you just
   typed stays on screen and readable while the write lands. */
.bgt tbody tr.bgt-pending td { opacity: 0.45; }

/* Landed: one pale sweep over the row that changed, so a save is visible
   without anything moving. */
@keyframes bgt-flash { from { background: rgba(255,255,255,0.20); } to { background: transparent; } }
.bgt tbody tr.bgt-saved td { animation: bgt-flash ${ROW_FLASH_MS}ms ease-out; }

/* Gone: the row slides out on its own instead of the table blinking. It is
   still in the DOM here — React drops it once the animation is over. */
@keyframes bgt-leave { to { opacity: 0; transform: translateX(-14px); } }
.bgt tbody tr.bgt-leaving { animation: bgt-leave ${ROW_EXIT_MS}ms ease-in forwards; pointer-events: none; }

@media (prefers-reduced-motion: reduce) {
  .bgt tbody tr.bgt-saved td,
  .bgt tbody tr.bgt-leaving { animation-duration: 1ms; }
}`;

export function BrandGraphDataTable({ workspaceId, onOpenTemplate, onRefreshGraph }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ id: string; col: "brandName" | "name" } | null>(null);
  const [draft, setDraft] = useState("");
  const lastClicked = useRef<number | null>(null);
  /** Rows with a write in flight, and rows whose write just landed. */
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<Set<string>>(new Set());
  /** Rows that left the view and are still animating out. */
  const [exiting, setExiting] = useState<Array<{ row: Row; index: number }>>([]);
  /** Only the very first fetch may blank the table. */
  const hasLoaded = useRef(false);
  const timers = useRef<number[]>([]);

  const later = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timers.current.push(id);
  }, []);
  useEffect(() => () => { for (const id of timers.current) window.clearTimeout(id); }, []);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    // Every refresh after the first is silent. Swapping the whole table for
    // "Cargando..." on each save is what made an edit look like a page reload.
    if (hasLoaded.current) setSyncing(true); else setLoading(true);
    setError("");
    try {
      const res = await apiFetch<{ success: boolean; data?: GraphRoot }>(
        `/api/brand-graph?workspaceId=${workspaceId}`,
      );
      if (!res.success || !res.data) throw new Error("No se pudo cargar");
      // Keyed by templateId, not by node id: one file must never produce two
      // rows, or React sees duplicate keys and an edit lands on whichever copy
      // `find` happened to reach first.
      const out = new Map<string, Row>();
      const walk = (n: GraphNode, brandId: string, brandName: string, category: string) => {
        // Campaign nodes are `kind: "category"` too — only the four real
        // branches name the Categoria column, or a file inside a campaign
        // group would show the campaign there and the select would read "-".
        const cat = n.kind === "category" && CATEGORIES.includes(n.name) ? n.name : category;
        if (n.templateId && !n.ghost && !out.has(n.templateId)) {
          out.set(n.templateId, {
            id: n.id, templateId: n.templateId, brandId, brandName,
            category: cat, name: n.name,
          });
        }
        for (const c of n.children || []) walk(c, brandId, brandName, cat);
      };
      for (const b of res.data.brands || []) {
        for (const c of b.children || []) walk(c, b.id, b.name, "");
      }
      for (const o of res.data.orphans || []) walk(o, "", "", "");

      // The graph draws every brand; this table drew only brands that own a
      // file, so a brand you could see in the graph was invisible here and
      // there was nowhere to delete it from. Ask the workspace for the real
      // list and add a placeholder row for whatever is missing.
      const rows = [...out.values()];
      let allBrands: Brand[] = [];
      try {
        const brandRes = await apiFetch<{ success?: boolean; data?: Brand[] }>(
          `/api/workspaces/${workspaceId}/brands`,
        );
        allBrands = Array.isArray(brandRes?.data) ? brandRes.data : [];
      } catch { /* the file rows are still worth showing */ }
      const withFiles = new Set(rows.map(r => r.brandId).filter(Boolean));
      for (const brand of allBrands) {
        if (withFiles.has(brand.id)) continue;
        rows.push({
          id: `brand:${brand.id}`, templateId: "", brandId: brand.id,
          brandName: brand.name, category: "", name: "", brandOnly: true,
        });
      }
      setRows(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar");
    } finally {
      hasLoaded.current = true;
      setLoading(false);
      setSyncing(false);
    }
  }, [workspaceId]);

  useEffect(() => { load(); }, [load]);

  const brands = useMemo(
    () => [...new Set(rows.map(r => r.brandName).filter(Boolean))].sort(),
    [rows],
  );
  const visible = useMemo(
    () => (brandFilter ? rows.filter(r => r.brandName === brandFilter) : rows),
    [rows, brandFilter],
  );
  const emptyBrandCount = useMemo(() => visible.filter(r => r.brandOnly).length, [visible]);

  // Hold on to rows that just left the view — deleted, or moved out from under
  // the brand filter — so they can animate out from where they were standing
  // instead of vanishing between two renders.
  const prevVisible = useRef<Row[]>([]);
  useEffect(() => {
    const prev = prevVisible.current;
    prevVisible.current = visible;
    if (!prev.length) return;
    const present = new Set(visible.map(r => r.id));
    const gone = prev
      .map((row, index) => ({ row, index }))
      .filter(e => !present.has(e.row.id));
    if (!gone.length) return;
    setExiting(cur => [...cur, ...gone]);
    const goneIds = new Set(gone.map(e => e.row.id));
    later(() => setExiting(cur => cur.filter(e => !goneIds.has(e.row.id))), ROW_EXIT_MS);
  }, [visible, later]);

  /**
   * The rows on screen: what is here now, plus what is on its way out, put
   * back where it was standing. Each carries its index into `visible` — a
   * leaving row has none, and range-select has to keep counting in terms of
   * the real list or a row mid-animation would shift every selection below it.
   */
  const rendered = useMemo(() => {
    const out = visible.map((row, vIndex) => ({ row, leaving: false, vIndex }));
    for (const e of [...exiting].sort((a, b) => a.index - b.index)) {
      if (out.some(r => r.row.id === e.row.id)) continue; // came back before the timer
      out.splice(Math.min(e.index, out.length), 0, { row: e.row, leaving: true, vIndex: -1 });
    }
    return out;
  }, [visible, exiting]);

  const markSaved = useCallback((id: string) => {
    setSaved(cur => new Set(cur).add(id));
    later(() => setSaved(cur => { const s = new Set(cur); s.delete(id); return s; }), ROW_FLASH_MS);
  }, [later]);

  /**
   * Writes one cell. The new value is on screen before the request leaves, and
   * the table never unmounts: the row dims, the server answers, the row
   * flashes. A rejected write puts the old value back — the optimistic one was
   * a guess and it lost.
   */
  const save = useCallback(async (
    row: Row, url: string, body: Record<string, unknown>, what: string, optimistic: Partial<Row>,
  ) => {
    setSaveError("");
    setRows(cur => cur.map(r => (r.id === row.id ? { ...r, ...optimistic } : r)));
    setPending(cur => new Set(cur).add(row.id));
    try {
      const res = await apiFetch<{ success?: boolean; error?: string }>(url, {
        method: "PUT", body: JSON.stringify(body),
      });
      // The API answers 200 with success:false for anything it declined.
      if (res && res.success === false) throw new Error(res.error || "El servidor rechazo el cambio");
      if (row.templateId) notifyMetaChanged(row.templateId);
      await load();
      onRefreshGraph?.();
      markSaved(row.id);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`No se pudo guardar ${what}:`, e);
      setSaveError(`No se pudo guardar ${what}: ${message}`);
      setRows(cur => cur.map(r => (r.id === row.id ? row : r)));
    } finally {
      setPending(cur => { const s = new Set(cur); s.delete(row.id); return s; });
    }
  }, [load, onRefreshGraph, markSaved]);

  const commit = useCallback(async () => {
    if (!editing) return;
    const row = rows.find(r => r.id === editing.id);
    const value = draft.trim();
    const col = editing.col;
    setEditing(null);
    if (!row || value === row[col]) return;
    if (col === "name") {
      // A file's name lives on `templates`, not on design_file_meta.
      if (!value) return;
      await save(row, `/api/templates/${row.templateId}`, { name: value }, "el nombre", { name: value });
    } else {
      // Sends the typed name; the API resolves it to a brand_id (creating the
      // brand when the name is new) because the graph files by id, not by the
      // loose text. Emptying the cell unfiles the row.
      await save(row, `/api/meta/${row.templateId}`, { brand: value }, "la marca", { brandName: value });
    }
  }, [editing, draft, rows, save]);

  const setCategory = useCallback(
    (row: Row, value: string) =>
      save(row, `/api/meta/${row.templateId}`, { category: value }, "la categoria", { category: value }),
    [save],
  );

  const deleteSelected = useCallback(async () => {
    if (!selected.size) return;
    const targets = rows.filter(r => selected.has(r.id));
    const brandTargets = targets.filter(r => r.brandOnly);

    // Deleting a file is a soft delete it can come back from. Deleting a brand
    // is not: it unfiles every design that pointed at it, across the whole
    // database, and takes it out of the graph. Worth asking first.
    if (brandTargets.length) {
      const names = brandTargets.map(r => r.brandName).join(", ");
      const ok = window.confirm(
        `Se eliminaran ${brandTargets.length === 1 ? "la marca" : "las marcas"} ${names} de toda la base de datos.\n\n` +
        "Los archivos que tuvieran esa marca no se borran: quedan sin marca. Esto no se puede deshacer.\n\n" +
        "¿Continuar?",
      );
      if (!ok) return;
    }

    setSelected(new Set());
    setSaveError("");
    setPending(cur => { const s = new Set(cur); for (const r of targets) s.add(r.id); return s; });
    const failed = new Set<string>();
    let message = "";
    for (const r of targets) {
      try {
        if (r.brandOnly) {
          await apiFetch(`/api/workspaces/${workspaceId}/brands/${r.brandId}`, { method: "DELETE" });
        } else {
          await apiFetch(`/api/templates/${r.templateId}`, { method: "DELETE" });
        }
      } catch (e) {
        failed.add(r.id);
        message = e instanceof Error ? e.message : String(e);
        console.error("No se pudo eliminar:", e);
      }
    }
    // Drop the deleted rows here rather than waiting for the refetch: this is
    // what starts the exit animation, and the reload only has to confirm it.
    const removed = new Set(targets.filter(r => !failed.has(r.id)).map(r => r.id));
    if (removed.size) setRows(cur => cur.filter(r => !removed.has(r.id)));
    setPending(cur => { const s = new Set(cur); for (const r of targets) s.delete(r.id); return s; });
    if (failed.size) {
      setSaveError(`No se pudieron eliminar ${failed.size} de ${targets.length}: ${message}`);
    }
    await load();
    onRefreshGraph?.();
  }, [selected, rows, load, onRefreshGraph, workspaceId]);

  // The editor's Information panel is the other view of these same rows.
  useEffect(() => onMetaChanged(() => { void load(); }), [load]);

  // Delete key removes the selection, the way a sheet does.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing) return;
      if (e.key !== "Delete") return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      e.preventDefault();
      deleteSelected();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, deleteSelected]);

  const selectRow = (idx: number, e: React.MouseEvent) => {
    const row = visible[idx];
    if (!row) return;
    const next = new Set(selected);
    if (e.shiftKey && lastClicked.current !== null) {
      const a = Math.min(lastClicked.current, idx);
      const b = Math.max(lastClicked.current, idx);
      for (let i = a; i <= b; i++) if (visible[i]) next.add(visible[i].id);
    } else if (e.ctrlKey || e.metaKey) {
      if (next.has(row.id)) next.delete(row.id); else next.add(row.id);
    } else {
      next.clear();
      next.add(row.id);
    }
    lastClicked.current = idx;
    setSelected(next);
  };

  const edit = (row: Row, col: "brandName" | "name") => {
    setEditing({ id: row.id, col });
    setDraft(row[col]);
  };

  // Only the first fetch, before there is anything to show, may take the whole
  // pane. Once rows exist they stay on screen through every later refresh.
  if (loading) {
    return <div style={{ padding: 24, color: "rgba(255,255,255,0.5)", fontSize: 13 }}>Cargando...</div>;
  }
  if (error && !rows.length) {
    return (
      <div style={{ padding: 24, color: "rgba(255,255,255,0.6)", fontSize: 13 }}>
        {error}{" "}
        <button type="button" onClick={load} style={btn}>Reintentar</button>
      </div>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#000" }}>
      <style>{TABLE_CSS}</style>

      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "10px 20px",
        borderBottom: "1px solid rgba(255,255,255,0.14)", flexShrink: 0,
      }}>
        <select value={brandFilter} onChange={e => setBrandFilter(e.target.value)} style={control}>
          <option value="" style={{ background: "#000" }}>Todas las marcas</option>
          {brands.map(b => <option key={b} value={b} style={{ background: "#000" }}>{b}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        {/* A refresh says so here, in a corner, instead of taking the table. */}
        <span
          aria-hidden={!syncing}
          style={{
            fontSize: 12, color: "rgba(255,255,255,0.45)",
            opacity: syncing ? 1 : 0, transition: "opacity 150ms",
          }}
        >Actualizando...</span>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>
          {visible.filter(r => !r.brandOnly).length} archivos
          {emptyBrandCount > 0 ? ` · ${emptyBrandCount} marcas sin archivos` : ""}
          {selected.size ? ` · ${selected.size} seleccionadas` : ""}
        </span>
        <button
          type="button"
          onClick={deleteSelected}
          disabled={selected.size === 0}
          style={{ ...btn, opacity: selected.size ? 1 : 0.35, cursor: selected.size ? "pointer" : "default" }}
        >Eliminar</button>
        <button type="button" onClick={load} style={btn}>Sincronizar</button>
      </div>

      {/* Also carries a failed background refresh: with rows already on screen
          the full-pane error state never renders, and a silent refresh that
          dies would otherwise leave the table quietly showing stale rows. */}
      {(saveError || error) && (
        <div role="alert" style={{
          display: "flex", alignItems: "center", gap: 10, padding: "8px 20px",
          borderBottom: "1px solid rgba(255,255,255,0.14)", flexShrink: 0,
          fontSize: 12, color: "#fff", background: "rgba(255,255,255,0.10)",
        }}>
          <span style={{ flex: 1 }}>{saveError || `No se pudo actualizar la tabla: ${error}`}</span>
          <button
            type="button"
            onClick={() => { setSaveError(""); setError(""); }}
            style={btn}
          >Cerrar</button>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "0 20px 20px" }}>
        <table className="bgt" style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
          <thead>
            <tr>
              {["Marca", "Categoria", "Archivo"].map((h, i) => (
                <th key={h} style={{
                  ...CELL, width: i === 2 ? "auto" : "28%",
                  position: "sticky", top: 0, zIndex: 1,
                  background: "#000", fontWeight: 600,
                  color: "rgba(255,255,255,0.65)", fontSize: 12,
                  borderBottom: "1px solid rgba(255,255,255,0.28)",
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rendered.map(({ row, leaving, vIndex }) => {
              const isSel = selected.has(row.id);
              const cell = { ...CELL, background: isSel ? "rgba(255,255,255,0.14)" : "transparent" };
              const cls = [
                leaving ? "bgt-leaving" : "",
                pending.has(row.id) ? "bgt-pending" : "",
                saved.has(row.id) ? "bgt-saved" : "",
              ].filter(Boolean).join(" ");
              return (
                <tr
                  key={row.id}
                  className={cls || undefined}
                  onClick={e => { if (!leaving) selectRow(vIndex, e); }}
                >
                  <td
                    style={cell}
                    onDoubleClick={() => { if (!row.brandOnly) edit(row, "brandName"); }}
                    title={row.brandOnly
                      ? "Marca sin archivos"
                      : "Doble click para archivar bajo otra marca - una marca nueva se crea sola"}
                  >
                    {editing && editing.id === row.id && editing.col === "brandName"
                      ? <Field value={draft} onChange={setDraft} onCommit={commit} onCancel={() => setEditing(null)} />
                      : (row.brandName || "Sin marca")}
                  </td>
                  {/* A brand with no files has no category and no file to name.
                      Showing empty controls there would invite edits that
                      cannot land anywhere. */}
                  <td style={cell} onClick={e => e.stopPropagation()}>
                    {row.brandOnly ? (
                      <span style={{ color: "rgba(255,255,255,0.35)" }}>—</span>
                    ) : (
                      <select
                        value={CATEGORIES.indexOf(row.category) >= 0 ? row.category : ""}
                        onChange={e => setCategory(row, e.target.value)}
                        style={{ ...control, width: "100%", border: "none", padding: 0 }}
                      >
                        <option value="" style={{ background: "#000" }}>-</option>
                        {CATEGORIES.map(c => (
                          <option key={c} value={c} style={{ background: "#000" }}>{c}</option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td
                    style={cell}
                    onDoubleClick={() => { if (!row.brandOnly) edit(row, "name"); }}
                    title={row.brandOnly
                      ? "Marca sin archivos - seleccionala y pulsa Eliminar para borrarla de toda la base"
                      : "Doble click para renombrar - alt+click para abrir"}
                  >
                    {row.brandOnly ? (
                      <span style={{ color: "rgba(255,255,255,0.35)", fontStyle: "italic" }}>
                        marca sin archivos
                      </span>
                    ) : editing && editing.id === row.id && editing.col === "name"
                      ? <Field value={draft} onChange={setDraft} onCommit={commit} onCancel={() => setEditing(null)} />
                      : (
                        <span onClick={e => {
                          if (e.altKey) { e.stopPropagation(); onOpenTemplate?.(row.templateId); }
                        }}>{row.name || "(sin nombre)"}</span>
                      )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Field({
  value, onChange, onCommit, onCancel,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // preventScroll: focusing without it yanks the viewport to the row.
    ref.current?.focus({ preventScroll: true });
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      value={value}
      onClick={e => e.stopPropagation()}
      onChange={e => onChange(e.target.value)}
      onKeyDown={e => {
        e.stopPropagation();
        if (e.key === "Enter") { e.preventDefault(); onCommit(); }
        if (e.key === "Escape") { onCancel(); }
      }}
      onBlur={onCommit}
      style={{
        width: "100%", background: "#000", color: "#fff",
        border: "1px solid #fff", borderRadius: 0,
        padding: "2px 4px", fontSize: 13, fontFamily: "inherit", outline: "none",
      }}
    />
  );
}
