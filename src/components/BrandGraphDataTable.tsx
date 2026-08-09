/**
 * BrandGraphDataTable — editable, resizable table view of the brand hierarchy.
 *
 * Mirrors the Red de Marcas graph data in a flat, filterable table with:
 *   - Color-coded rows matching brand palette
 *   - Inline-editable cells (name, brand, campaign, obsidian_link)
 *   - Resizable columns (drag border to resize)
 *   - Delete brand action (soft-delete with cascade DS option)
 *   - Sync/refresh button
 *   - Click template → open in editor
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/supabase";

// ── Types ──

type BrandGraphNodeKind = "workspace" | "brand" | "category" | "template" | "asset" | "frame";

interface BrandGraphNode {
  id: string;
  name: string;
  level: number;
  kind: BrandGraphNodeKind;
  color: string;
  templateId?: string;
  obsidianLink?: string;
  category?: string;
  campaign?: string;
  /** Placeholder for an unfilled category — has no real file to delete. */
  ghost?: boolean;
  orphan?: boolean;
  children: BrandGraphNode[];
}

interface BrandGraphRoot {
  workspaceId: string;
  workspaceName: string;
  brands: BrandGraphNode[];
  /** Files not filed under any brand. */
  orphans?: BrandGraphNode[];
}

/** Flattened row for table display. */
interface FlatRow {
  id: string;
  name: string;
  level: number;
  kind: BrandGraphNodeKind;
  color: string;
  brandName: string;
  brandId: string;
  category: string;
  campaign: string;
  templateId: string;
  obsidianLink: string;
  /** Indentation depth for tree view */
  depth: number;
  /** Original node reference for child access */
  _node: BrandGraphNode;
}

interface Props {
  workspaceId: string | null;
  onOpenTemplate?: (templateId: string) => void;
  onRefreshGraph?: () => void;
}

// ── Column definition ──

interface ColumnDef {
  key: string;
  label: string;
  minWidth: number;
  defaultWidth: number;
  editable?: boolean;
  monospace?: boolean;
  /** Which field to patch via PUT /api/meta/:templateId */
  metaField?: string;
}

const COLUMNS: ColumnDef[] = [
  { key: "brandName", label: "Marca", minWidth: 90, defaultWidth: 140, editable: true, metaField: "brand" },
  { key: "name", label: "Nombre", minWidth: 100, defaultWidth: 180, editable: true },
  { key: "kind", label: "Tipo", minWidth: 60, defaultWidth: 80 },
  { key: "category", label: "Categoría", minWidth: 70, defaultWidth: 100 },
  { key: "campaign", label: "Campaña", minWidth: 80, defaultWidth: 120, editable: true, metaField: "campaign" },
  { key: "obsidianLink", label: "Obsidian", minWidth: 60, defaultWidth: 80, editable: true, metaField: "obsidian_link" },
  { key: "templateId", label: "Template ID", minWidth: 100, defaultWidth: 140, monospace: true },
  { key: "actions", label: "Acciones", minWidth: 60, defaultWidth: 80 },
];

// ── Component ──

export function BrandGraphDataTable({ workspaceId, onOpenTemplate, onRefreshGraph }: Props) {
  const [rows, setRows] = useState<FlatRow[]>([]);
  const [allRows, setAllRows] = useState<FlatRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    const w: Record<string, number> = {};
    COLUMNS.forEach(c => { w[c.key] = c.defaultWidth; });
    return w;
  });
  const [resizing, setResizing] = useState<string | null>(null);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);
  const [editingCell, setEditingCell] = useState<{ rowId: string; colKey: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // ── Flatten ──

  function flattenTree(root: BrandGraphRoot): FlatRow[] {
    const result: FlatRow[] = [];

    function walk(node: BrandGraphNode, brandName: string, brandId: string, depth: number) {
      // Determine brand context
      const bn = node.kind === "brand" ? node.name : brandName;
      const bi = node.kind === "brand" ? node.id : brandId;

      // Brand and category nodes were emitted as header rows, which read like
      // collapsed dropdowns. Only real files are rows now; the brand is a
      // merged cell in the leftmost column instead. Ghosts never had a file.
      if (node.templateId && !node.ghost) result.push({
        id: node.id,
        name: node.name,
        level: node.level,
        kind: node.kind,
        color: node.color,
        brandName: bn,
        brandId: bi,
        category: node.category || (node.kind === "category" ? node.name : ""),
        campaign: node.campaign || "",
        templateId: node.templateId || "",
        obsidianLink: node.obsidianLink || "",
        depth,
        _node: node,
      });

      // walk() already recurses, so descending into the grandchildren here as
      // well duplicated every node from depth 2 down -- campaign files showed
      // up twice, ghosts twice, and the row count ran to 689 instead of ~290.
      if (node.children) {
        for (const child of node.children) {
          walk(child, bn, bi, depth + 1);
        }
      }
    }

    for (const brand of root.brands) {
      walk(brand, brand.name, brand.id, 0);
    }
    // Unfiled files belong in the table too -- it's the fastest place to give
    // them a brand, which is the whole point of surfacing them.
    for (const orphan of root.orphans || []) {
      walk(orphan, "", "", 0);
    }
    return result;
  }

  // ── Fetch ──

  const fetchData = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch<{ success: boolean; data?: BrandGraphRoot }>(
        `/api/brand-graph?workspaceId=${workspaceId}`,
      );
      if (!res.success) throw new Error("Failed to load");
      const flat = flattenTree(res.data!);
      setAllRows(flat);
      setRows(flat);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Filters ──

  useEffect(() => {
    let filtered = allRows;
    if (brandFilter) {
      filtered = filtered.filter(r =>
        r.brandName.toLowerCase().includes(brandFilter.toLowerCase()),
      );
    }
    if (kindFilter) {
      filtered = filtered.filter(r => r.kind.toLowerCase().includes(kindFilter.toLowerCase()));
    }
    setRows(filtered);
  }, [brandFilter, kindFilter, allRows]);

  const uniqueBrands = [...new Set(allRows.map(r => r.brandName))].sort();
  const uniqueKinds = [...new Set(allRows.map(r => r.kind))].sort();

  // ── Column resize ──

  const onResizeStart = useCallback((colKey: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setResizing(colKey);
    resizeStartX.current = e.clientX;
    resizeStartW.current = colWidths[colKey] || COLUMNS.find(c => c.key === colKey)!.defaultWidth;
  }, [colWidths]);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      const delta = e.clientX - resizeStartX.current;
      const newW = Math.max(
        COLUMNS.find(c => c.key === resizing)!.minWidth,
        resizeStartW.current + delta,
      );
      setColWidths(prev => ({ ...prev, [resizing]: newW }));
    };
    const onUp = () => setResizing(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [resizing]);

  // ── Inline edit ──

  const startEdit = (rowId: string, colKey: string, currentValue: string) => {
    setEditingCell({ rowId, colKey });
    setEditValue(currentValue);
  };

  const commitEdit = useCallback(async () => {
    if (!editingCell) return;
    const row = allRows.find(r => r.id === editingCell.rowId);
    if (!row) { setEditingCell(null); return; }

    const col = COLUMNS.find(c => c.key === editingCell.colKey);
    if (!col?.metaField) { setEditingCell(null); return; }

    const trimmed = editValue.trim();

    // Handle name edits (rename template)
    if (editingCell.colKey === "name" && row.templateId) {
      try {
        await apiFetch(`/api/templates/${row.templateId}`, {
          method: "PATCH",
          body: JSON.stringify({ name: trimmed }),
        });
      } catch { /* ignore */ }
    }

    // Handle meta edits
    if (col.metaField && row.templateId) {
      try {
        await apiFetch(`/api/meta/${row.templateId}`, {
          method: "PUT",
          body: JSON.stringify({ [col.metaField]: trimmed }),
        });
      } catch { /* ignore */ }
    }

    setEditingCell(null);
    fetchData(); // refresh
    onRefreshGraph?.();
  }, [editingCell, editValue, allRows, fetchData, onRefreshGraph]);

  const cancelEdit = () => setEditingCell(null);

  // Handle key events on the editing input
  useEffect(() => {
    if (!editingCell) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelEdit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingCell]);

  // ── Delete brand ──

  /** Soft-delete one design file. */
  const deleteFile = useCallback(async (templateId: string) => {
    try {
      await apiFetch(`/api/templates/${templateId}`, { method: "DELETE" });
      fetchData();
      onRefreshGraph?.();
    } catch (e) {
      console.error("Failed to delete file:", e);
    }
  }, [fetchData, onRefreshGraph]);

  const deleteBrand = useCallback(async (brandId: string, withFiles = false) => {
    if (!workspaceId) return;
    try {
      // Brands come from the `brands` table now, so the old MCP call
      // delete_brand_guideline targeted the styles table and answered 400 on
      // every click. This route also nulls design_file_meta.brand_id first, so
      // the brand's files survive and simply become unfiled.
      // "With files" has to run first: the brand route nulls out
      // design_file_meta.brand_id, which is the only thing tying these files
      // to the brand. Delete the brand first and they are unreachable.
      if (withFiles) {
        const ids = allRows
          .filter(r => r.brandId === brandId && r.templateId)
          .map(r => r.templateId);
        for (const id of [...new Set(ids)]) {
          await apiFetch(`/api/templates/${id}`, { method: "DELETE" });
        }
      }
      await apiFetch(`/api/workspaces/${workspaceId}/brands/${brandId}`, {
        method: "DELETE",
      });
      setConfirmDelete(null);
      fetchData();
      onRefreshGraph?.();
    } catch (e) {
      console.error("Failed to delete brand:", e);
    }
  }, [workspaceId, fetchData, onRefreshGraph, allRows]);

  // ── Row filtering utilities ──

  const isBrandRow = (row: FlatRow) => row.kind === "brand";
  const isCategoryRow = (row: FlatRow) => row.kind === "category" && row.level >= 2;
  const isItemRow = (row: FlatRow) =>
    ["template", "asset", "frame"].includes(row.kind);

  const kindLabel = (kind: BrandGraphNodeKind): string => {
    switch (kind) {
      case "brand": return "Marca";
      case "category": return "Categoría";
      case "template": return "Template";
      case "asset": return "Asset";
      case "frame": return "Frame";
      case "workspace": return "Workspace";
      default: return kind;
    }
  };

  const kindIcon = (kind: BrandGraphNodeKind): string => {
    switch (kind) {
      case "brand": return "◆";
      case "category": return "▸";
      case "template": return "📄";
      case "asset": return "🖼";
      case "frame": return "▣";
      case "workspace": return "◉";
      default: return "·";
    }
  };

  // ── Render ──

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#777", fontSize: 13 }}>
        Cargando datos…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 10, color: "#fca5a5", fontSize: 13 }}>
        <span>Error al cargar datos</span>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{error}</span>
        <button onClick={fetchData} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.07)", color: "#fff", cursor: "pointer" }}>Reintentar</button>
      </div>
    );
  }

  const totalWidth = Object.values(colWidths).reduce((a, b) => a + b, 0);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", fontFamily: "Inter, system-ui, sans-serif" }}>
      {/* ═══ Toolbar: filters + refresh + delete confirm ═══ */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
        borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0,
        background: "rgba(12,14,20,0.96)", backdropFilter: "blur(8px)",
        flexWrap: "wrap",
      }}>
        {/* Plain text filters, not dropdowns: this is meant to read as a
            spreadsheet, so filtering is typing, the way a sheet behaves. */}
        <input
          value={brandFilter}
          onChange={e => setBrandFilter(e.target.value)}
          placeholder="Filtrar marca"
          style={filterSelectStyle}
        />
        <input
          value={kindFilter}
          onChange={e => setKindFilter(e.target.value)}
          placeholder="Filtrar tipo"
          style={filterSelectStyle}
        />
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
          {rows.length} filas
        </span>
        <button
          onClick={fetchData}
          title="Sincronizar"
          style={toolBtnStyle}
        >
          ↻ Sincronizar
        </button>
      </div>

      {/* ═══ Delete confirmation ═══ */}
      {confirmDelete && (
        <div style={{
          padding: "10px 14px", borderBottom: "1px solid rgba(255,75,114,0.3)",
          background: "rgba(255,75,114,0.1)", display: "flex", alignItems: "center", gap: 10,
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 12, color: "#fff", flex: 1 }}>
            ¿Eliminar esta marca? También se puede eliminar su archivo Design System.
          </span>
          <button onClick={() => deleteBrand(confirmDelete, false)} style={{ ...toolBtnStyle, borderColor: "rgba(255,255,255,0.35)", color: "#fff" }}>
            Solo la marca — los archivos quedan sin marca
          </button>
          <button onClick={() => deleteBrand(confirmDelete, true)} style={{ ...toolBtnStyle, borderColor: "rgba(255,255,255,0.6)", color: "#fff", fontWeight: 600 }}>
            Marca y sus archivos
          </button>
          <button onClick={() => setConfirmDelete(null)} style={{ ...toolBtnStyle, color: "rgba(255,255,255,0.4)" }}>
            Cancelar
          </button>
        </div>
      )}

      {/* ═══ Table ═══ */}
      <div style={{ flex: 1, overflow: "auto" }}>
        <table style={{
          width: totalWidth, minWidth: "100%", borderCollapse: "collapse",
          fontSize: 12, tableLayout: "fixed",
        }}>
          <thead>
            <tr>
              {COLUMNS.map(col => (
                <th key={col.key} style={{
                  ...thBaseStyle,
                  width: colWidths[col.key],
                  minWidth: col.minWidth,
                  position: "relative",
                }}>
                  {col.label}
                  {/* Resize handle */}
                  <div
                    onMouseDown={e => onResizeStart(col.key, e)}
                    style={{
                      position: "absolute", right: 0, top: 0, bottom: 0,
                      width: 4, cursor: "col-resize",
                      background: resizing === col.key ? "rgba(99,102,241,0.5)" : "transparent",
                      zIndex: 5,
                    }}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              // First row of a same-brand run carries the merged cell.
              const prevRow = idx > 0 ? rows[idx - 1] : null;
              let brandSpan = 0;
              if (!prevRow || prevRow.brandName !== row.brandName) {
                brandSpan = 1;
                while (idx + brandSpan < rows.length && rows[idx + brandSpan].brandName === row.brandName) brandSpan++;
              }
              const isBrand = isBrandRow(row);
              const isCat = isCategoryRow(row);

              return (
                <tr
                  key={row.id}
                  style={{
                    background: isBrand
                      ? "rgba(255,255,255,0.08)"
                      : isCat
                        ? "rgba(255,255,255,0.04)"
                        : "transparent",
                    borderBottom: isBrand
                      ? "1px solid rgba(255,255,255,0.18)"
                      : "1px solid rgba(255,255,255,0.03)",
                    cursor: row.templateId ? "pointer" : "default",
                  }}
                  onClick={() => {
                    if (row.templateId) onOpenTemplate?.(row.templateId);
                  }}
                >
                  {/* Color indicator */}
                  {/* Merged brand cell: only the first row of a same-brand run
                      renders it, spanning the rest, the way a sheet merges. */}
                  {brandSpan > 0 && (
                    <td rowSpan={brandSpan} style={{
                      ...tdBaseStyle, width: colWidths["brandName"],
                      verticalAlign: "top", fontWeight: 600, color: "#fff",
                      borderRight: "1px solid rgba(255,255,255,0.14)",
                    }}>
                      <span>{row.brandName || "Sin marca"}</span>
                      {row.brandId && (
                        <button
                          onClick={e => { e.stopPropagation(); setConfirmDelete(row.brandId); }}
                          title="Eliminar marca"
                          style={{ ...iconBtnStyle, marginLeft: 6 }}
                        >
                          🗑
                        </button>
                      )}
                    </td>
                  )}

                  {/* Name (editable) */}
                  <td style={{ ...tdBaseStyle, width: colWidths["name"], paddingLeft: 8 + row.depth * 16 }}>
                    {editingCell?.rowId === row.id && editingCell?.colKey === "name" ? (
                      <EditingInput
                        value={editValue}
                        onChange={setEditValue}
                        onCommit={commitEdit}
                        onCancel={cancelEdit}
                      />
                    ) : (
                      <span
                        style={{
                          fontWeight: isBrand ? 600 : isCat ? 500 : 400,
                          fontSize: isBrand ? 13 : 12,
                          color: isBrand ? "#fff" : isCat ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.7)",
                          cursor: "text",
                        }}
                        onClick={e => {
                          e.stopPropagation();
                          startEdit(row.id, "name", row.name);
                        }}
                        title="Click para editar"
                      >
                        <span style={{ marginRight: 4, fontSize: 10, opacity: 0.6 }}>
                          {kindIcon(row.kind)}
                        </span>
                        {row.name || "(sin nombre)"}
                      </span>
                    )}
                  </td>

                  {/* Kind */}
                  <td style={{ ...tdBaseStyle, width: colWidths["kind"], color: "rgba(255,255,255,0.45)", fontSize: 10 }}>
                    {kindLabel(row.kind)}
                  </td>

                  {/* Category */}
                  <td style={{ ...tdBaseStyle, width: colWidths["category"], color: "rgba(255,255,255,0.55)" }}>
                    {row.category}
                  </td>

                  {/* Campaign (editable for templates) */}
                  <td style={{ ...tdBaseStyle, width: colWidths["campaign"] }}>
                    {editingCell?.rowId === row.id && editingCell?.colKey === "campaign" && row.templateId ? (
                      <EditingInput value={editValue} onChange={setEditValue} onCommit={commitEdit} onCancel={cancelEdit} />
                    ) : (
                      <span
                        style={{ color: "rgba(255,255,255,0.6)", cursor: row.templateId ? "text" : "default", fontSize: row.campaign ? 12 : 11 }}
                        onClick={e => {
                          if (!row.templateId) return;
                          e.stopPropagation();
                          startEdit(row.id, "campaign", row.campaign);
                        }}
                        title={row.templateId ? "Click para editar campaña" : undefined}
                      >
                        {row.campaign || "—"}
                      </span>
                    )}
                  </td>

                  {/* Obsidian Link */}
                  <td style={{ ...tdBaseStyle, width: colWidths["obsidianLink"] }}>
                    {editingCell?.rowId === row.id && editingCell?.colKey === "obsidianLink" && row.templateId ? (
                      <EditingInput value={editValue} onChange={setEditValue} onCommit={commitEdit} onCancel={cancelEdit} />
                    ) : row.obsidianLink ? (
                      <a
                        href={row.obsidianLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        style={{ color: "#fff", fontSize: 11, textDecoration: "none" }}
                        title={row.obsidianLink}
                      >
                        ◆ Link
                      </a>
                    ) : (
                      <span
                        style={{ color: "rgba(255,255,255,0.25)", cursor: row.templateId ? "text" : "default", fontSize: 11 }}
                        onClick={e => {
                          if (!row.templateId) return;
                          e.stopPropagation();
                          startEdit(row.id, "obsidianLink", "");
                        }}
                        title={row.templateId ? "Click para agregar link de Obsidian" : undefined}
                      >
                        —
                      </span>
                    )}
                  </td>

                  {/* Template ID */}
                  <td style={{
                    ...tdBaseStyle, width: colWidths["templateId"],
                    color: "rgba(255,255,255,0.3)", fontSize: 10,
                    fontFamily: "'SF Mono', monospace",
                    overflow: "hidden", textOverflow: "ellipsis",
                  }}>
                    {row.templateId
                      ? row.templateId.length > 16
                        ? row.templateId.slice(0, 8) + "…"
                        : row.templateId
                      : "—"}
                  </td>

                  {/* Actions */}
                  <td style={{ ...tdBaseStyle, width: colWidths["actions"], textAlign: "center" }}>
                    {isBrand && (
                      <button
                        onClick={e => { e.stopPropagation(); setConfirmDelete(row.id); }}
                        title="Eliminar marca"
                        style={iconBtnStyle}
                      >
                        🗑
                      </button>
                    )}
                    {row.templateId && (
                      <button
                        onClick={e => { e.stopPropagation(); onOpenTemplate?.(row.templateId); }}
                        title="Abrir en editor"
                        style={iconBtnStyle}
                      >
                        ↗
                      </button>
                    )}
                    {row.templateId && !row._node.ghost && (
                      <button
                        onClick={e => { e.stopPropagation(); deleteFile(row.templateId); }}
                        title="Eliminar archivo"
                        style={iconBtnStyle}
                      >
                        🗑
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} style={{ padding: 40, textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: 13 }}>
                  {brandFilter || kindFilter
                    ? "Sin resultados con los filtros actuales."
                    : "No hay datos. Crea una marca desde el panel de Style Library."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Sub-components ──

function EditingInput({
  value, onChange, onCommit, onCancel,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <input
      ref={ref}
      value={value}
      onChange={e => onChange(e.target.value)}
      onKeyDown={e => {
        if (e.key === "Enter") { e.preventDefault(); onCommit(); }
        if (e.key === "Escape") { onCancel(); }
      }}
      onBlur={onCommit}
      style={{
        width: "100%", minWidth: 60,
        background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.5)",
        borderRadius: 4, padding: "3px 6px", color: "#fff", fontSize: 12,
        fontFamily: "inherit", outline: "none",
      }}
    />
  );
}

// ── Styles ──

const filterSelectStyle: React.CSSProperties = {
  padding: "4px 8px", borderRadius: 6, fontSize: 11,
  background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
  color: "rgba(255,255,255,0.7)", fontFamily: "inherit", outline: "none",
  cursor: "pointer",
};

const toolBtnStyle: React.CSSProperties = {
  padding: "5px 12px", borderRadius: 6, cursor: "pointer", fontSize: 11,
  color: "rgba(255,255,255,0.6)", background: "transparent",
  border: "1px solid rgba(255,255,255,0.12)", fontFamily: "inherit",
};

const iconBtnStyle: React.CSSProperties = {
  padding: "2px 6px", borderRadius: 4, cursor: "pointer", fontSize: 11,
  color: "rgba(255,255,255,0.5)", background: "transparent",
  border: "1px solid transparent", fontFamily: "inherit",
};

const thBaseStyle: React.CSSProperties = {
  textAlign: "left", padding: "8px 10px", position: "sticky", top: 0, zIndex: 2,
  background: "rgba(18,20,28,0.97)", backdropFilter: "blur(8px)",
  color: "rgba(255,255,255,0.4)", fontWeight: 500, fontSize: 10,
  textTransform: "uppercase", letterSpacing: 0.5,
  borderBottom: "1px solid rgba(255,255,255,0.08)", whiteSpace: "nowrap",
};

const tdBaseStyle: React.CSSProperties = {
  padding: "5px 10px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
};
