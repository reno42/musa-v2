/**
 * BrandGraphDataTable — the brand graph as a plain spreadsheet.
 *
 * Three columns, black and white, no icons: Marca · Categoria · Archivo.
 * Click rows to select (shift for a range, ctrl/cmd to toggle), press Delete
 * to remove them. Double-click a cell to edit it.
 *
 * Hover is CSS, not React state. An earlier version tracked the hovered row in
 * state, so every mouse move re-rendered all ~400 rows — that was the flicker,
 * the hang, and why typing appeared to do nothing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../lib/supabase";

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

/** One file. Brand and category are the branch it hangs from. */
interface Row {
  id: string;
  templateId: string;
  brandId: string;
  brandName: string;
  category: string;
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

const HOVER_CSS = ".bgt tbody tr:hover td { background: rgba(255,255,255,0.06); }";

export function BrandGraphDataTable({ workspaceId, onOpenTemplate, onRefreshGraph }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ id: string; col: "brandName" | "name" } | null>(null);
  const [draft, setDraft] = useState("");
  const lastClicked = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch<{ success: boolean; data?: GraphRoot }>(
        `/api/brand-graph?workspaceId=${workspaceId}`,
      );
      if (!res.success || !res.data) throw new Error("No se pudo cargar");
      const out: Row[] = [];
      const walk = (n: GraphNode, brandId: string, brandName: string, category: string) => {
        const cat = n.kind === "category" ? n.name : category;
        if (n.templateId && !n.ghost) {
          out.push({
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
      setRows(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar");
    } finally {
      setLoading(false);
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

  const commit = useCallback(async () => {
    if (!editing) return;
    const row = rows.find(r => r.id === editing.id);
    const value = draft.trim();
    const col = editing.col;
    setEditing(null);
    if (!row || !value || value === row[col]) return;
    try {
      if (col === "name") {
        // A file's name lives on `templates`, not on design_file_meta.
        await apiFetch(`/api/templates/${row.templateId}`, {
          method: "PUT", body: JSON.stringify({ name: value }),
        });
      } else {
        await apiFetch(`/api/meta/${row.templateId}`, {
          method: "PUT", body: JSON.stringify({ brand: value }),
        });
      }
      load();
      onRefreshGraph?.();
    } catch (e) {
      console.error("No se pudo guardar:", e);
    }
  }, [editing, draft, rows, load, onRefreshGraph]);

  const setCategory = useCallback(async (row: Row, value: string) => {
    try {
      await apiFetch(`/api/meta/${row.templateId}`, {
        method: "PUT", body: JSON.stringify({ category: value }),
      });
      load();
      onRefreshGraph?.();
    } catch (e) {
      console.error("No se pudo guardar la categoria:", e);
    }
  }, [load, onRefreshGraph]);

  const deleteSelected = useCallback(async () => {
    if (!selected.size) return;
    const targets = rows.filter(r => selected.has(r.id));
    setSelected(new Set());
    try {
      for (const r of targets) {
        await apiFetch(`/api/templates/${r.templateId}`, { method: "DELETE" });
      }
      load();
      onRefreshGraph?.();
    } catch (e) {
      console.error("No se pudo eliminar:", e);
    }
  }, [selected, rows, load, onRefreshGraph]);

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
    const next = new Set(selected);
    if (e.shiftKey && lastClicked.current !== null) {
      const a = Math.min(lastClicked.current, idx);
      const b = Math.max(lastClicked.current, idx);
      for (let i = a; i <= b; i++) next.add(visible[i].id);
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

  if (loading) {
    return <div style={{ padding: 24, color: "rgba(255,255,255,0.5)", fontSize: 13 }}>Cargando...</div>;
  }
  if (error) {
    return (
      <div style={{ padding: 24, color: "rgba(255,255,255,0.6)", fontSize: 13 }}>
        {error}{" "}
        <button type="button" onClick={load} style={btn}>Reintentar</button>
      </div>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#000" }}>
      <style>{HOVER_CSS}</style>

      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "10px 20px",
        borderBottom: "1px solid rgba(255,255,255,0.14)", flexShrink: 0,
      }}>
        <select value={brandFilter} onChange={e => setBrandFilter(e.target.value)} style={control}>
          <option value="" style={{ background: "#000" }}>Todas las marcas</option>
          {brands.map(b => <option key={b} value={b} style={{ background: "#000" }}>{b}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>
          {visible.length} filas{selected.size ? ` · ${selected.size} seleccionadas` : ""}
        </span>
        <button
          type="button"
          onClick={deleteSelected}
          disabled={selected.size === 0}
          style={{ ...btn, opacity: selected.size ? 1 : 0.35, cursor: selected.size ? "pointer" : "default" }}
        >Eliminar</button>
        <button type="button" onClick={load} style={btn}>Sincronizar</button>
      </div>

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
            {visible.map((row, idx) => {
              const isSel = selected.has(row.id);
              const cell = { ...CELL, background: isSel ? "rgba(255,255,255,0.14)" : "transparent" };
              return (
                <tr key={row.id} onClick={e => selectRow(idx, e)}>
                  <td style={cell} onDoubleClick={() => edit(row, "brandName")}>
                    {editing && editing.id === row.id && editing.col === "brandName"
                      ? <Field value={draft} onChange={setDraft} onCommit={commit} onCancel={() => setEditing(null)} />
                      : (row.brandName || "Sin marca")}
                  </td>
                  <td style={cell} onClick={e => e.stopPropagation()}>
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
                  </td>
                  <td
                    style={cell}
                    onDoubleClick={() => edit(row, "name")}
                    title="Doble click para renombrar - alt+click para abrir"
                  >
                    {editing && editing.id === row.id && editing.col === "name"
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
